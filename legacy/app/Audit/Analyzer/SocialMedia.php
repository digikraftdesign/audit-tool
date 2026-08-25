<?php

declare(strict_types=1);

namespace DK\Audit\Analyzer;

use DK\Audit\Rules;

/**
 * Social media audit.
 *
 * Platforms fight server-side reads, so this analyser is careful about what it
 * claims. It scores what it can actually see — bios, avatars, links, handles,
 * and (where a public feed exists) real posting cadence and view counts — and
 * hands the rest to the consultant to mark in the meeting rather than guessing.
 */
final class SocialMedia
{
    public const NETWORKS = [
        'instagram' => 'Instagram',
        'facebook'  => 'Facebook',
        'linkedin'  => 'LinkedIn',
        'youtube'   => 'YouTube',
        'x'         => 'X / Twitter',
    ];

    private const EXPECTED = ['instagram', 'linkedin', 'youtube'];

    /**
     * @param  array<string,array<string,mixed>> $profiles verification results per network
     * @param  array<string,mixed>               $in       intake answers
     * @return array{findings:array<int,array<string,mixed>>,coverage:array<string,string>,metrics:array<string,mixed>}
     */
    public static function run(array $profiles, array $in): array
    {
        $findings = [];
        $coverage = [
            'profile-optimization' => 'manual',
            'engagement'           => 'manual',
            'visual-consistency'   => 'manual',
            'posting-consistency'  => 'manual',
            'interaction'          => 'manual',   // never publicly measurable
        ];

        $readable = array_filter($profiles, static fn($p) => in_array($p['state'] ?? '', ['ok', 'thin'], true));
        $handles  = [];
        $names    = [];
        $avatars  = [];

        // =================================================== profile optimisation
        foreach ($profiles as $net => $p) {
            $label = self::NETWORKS[$net] ?? ucfirst((string) $net);

            if (($p['state'] ?? '') === 'missing') {
                $findings[] = Rules::make(
                    'sm-profile-unreachable',
                    'The ' . $label . ' URL returned HTTP ' . (int) ($p['status'] ?? 0) . '.',
                    ['network' => $label],
                    [['label' => 'URL', 'value' => (string) $p['url'], 'url' => (string) $p['url']],
                     ['label' => 'Response', 'value' => 'HTTP ' . (int) ($p['status'] ?? 0)]]
                );
                $coverage['profile-optimization'] = 'auto';
                continue;
            }
            if (!in_array($p['state'] ?? '', ['ok', 'thin'], true)) {
                continue; // blocked by the platform — reported, never scored
            }

            $coverage['profile-optimization'] = 'auto';

            $bio = trim((string) ($p['bio'] ?? ''));
            if ($bio === '') {
                $findings[] = Rules::make(
                    'sm-no-bio',
                    'The ' . $label . ' profile returned no description at all.',
                    ['network' => $label],
                    [['label' => 'Profile', 'value' => (string) $p['url'], 'url' => (string) $p['url']]]
                );
            } elseif (mb_strlen($bio) < 60) {
                $findings[] = Rules::make(
                    'sm-thin-bio',
                    'The ' . $label . ' bio reads “' . $bio . '” — ' . mb_strlen($bio) . ' characters.',
                    ['network' => $label, 'n' => (string) mb_strlen($bio)],
                    [['label' => 'Bio', 'value' => $bio]]
                );
            }

            if (trim((string) ($p['avatar'] ?? '')) === '') {
                $findings[] = Rules::make(
                    'sm-no-avatar',
                    'No profile image could be read from the ' . $label . ' profile.',
                    ['network' => $label],
                    [['label' => 'Profile', 'value' => (string) $p['url'], 'url' => (string) $p['url']]]
                );
            } else {
                $avatars[$net] = (string) $p['avatar'];
            }

            if (empty($p['outbound_link']) && $net !== 'youtube') {
                $findings[] = Rules::make(
                    'sm-no-link',
                    'No outbound link was found in the ' . $label . ' profile header.',
                    ['network' => $label],
                    [['label' => 'Profile', 'value' => (string) $p['url'], 'url' => (string) $p['url']]]
                );
            }

            if (!empty($p['handle'])) {
                $handles[$net] = (string) $p['handle'];
            }
            if (!empty($p['display_name'])) {
                $names[$net] = (string) $p['display_name'];
            }
        }

        // handles and names across platforms
        $uniqueHandles = array_values(array_unique(array_map(
            static fn($h) => preg_replace('/[^a-z0-9]/', '', mb_strtolower($h)) ?? $h,
            $handles
        )));
        if (count($handles) >= 2 && count($uniqueHandles) > 1) {
            $findings[] = Rules::make(
                'sm-handle-drift',
                'The account is @' . implode(' on one platform and @', array_values($handles)) . ' on another.',
                [],
                array_map(static fn($net, $h) => ['label' => self::NETWORKS[$net] ?? $net, 'value' => '@' . $h], array_keys($handles), $handles)
            );
        }
        $uniqueNames = array_values(array_unique(array_map('trim', $names)));
        if (count($uniqueNames) > 1) {
            $findings[] = Rules::make(
                'sm-name-drift',
                'The display name reads ' . implode(' / ', array_map(static fn($n) => '“' . $n . '”', $uniqueNames)) . ' across platforms.',
                ['n' => Rules::spell(count($uniqueNames))],
                array_map(static fn($net, $n) => ['label' => self::NETWORKS[$net] ?? $net, 'value' => $n], array_keys($names), $names)
            );
        }

        $present = array_keys(array_filter($profiles, static fn($p) => ($p['state'] ?? '') !== 'missing'));
        $gaps    = [];
        foreach (self::EXPECTED as $net) {
            if (!in_array($net, $present, true)) {
                $gaps[] = self::NETWORKS[$net];
            }
        }
        if ($gaps) {
            $findings[] = Rules::make(
                'sm-network-gap',
                'No ' . implode(' and no ', $gaps) . ' profile was supplied for this audit.',
                ['list' => implode(' or ', $gaps)],
                array_map(static fn($g) => ['label' => 'Missing channel', 'value' => $g], $gaps)
            );
            $coverage['profile-optimization'] = 'auto';
        }

        // =================================================== posting consistency
        foreach ($profiles as $net => $p) {
            $feed = $p['feed'] ?? null;
            if (!is_array($feed) || empty($feed['dates'])) {
                continue;
            }
            $coverage['posting-consistency'] = 'auto';
            $label = self::NETWORKS[$net] ?? ucfirst((string) $net);

            $dates = $feed['dates'];
            rsort($dates);
            $newest = strtotime((string) $dates[0]) ?: 0;
            $days   = $newest ? (int) floor((time() - $newest) / 86400) : 999;

            if ($days > 30) {
                $findings[] = Rules::make(
                    'sm-stale-account',
                    'The most recent ' . $label . ' post is dated ' . substr((string) $dates[0], 0, 10) . '.',
                    ['network' => $label, 'days' => (string) $days],
                    [['label' => 'Last post', 'value' => substr((string) $dates[0], 0, 10)],
                     ['label' => 'Days since', 'value' => (string) $days]],
                    $days > 90 ? 'high' : 'medium'
                );
            }

            $recent = 0;
            $cut    = time() - 90 * 86400;
            foreach ($dates as $d) {
                if ((strtotime((string) $d) ?: 0) >= $cut) {
                    $recent++;
                }
            }
            if ($recent < 6 && count($dates) >= 3) {
                $findings[] = Rules::make(
                    'sm-low-volume',
                    $label . ' published ' . $recent . ' time' . ($recent === 1 ? '' : 's') . ' in the last 90 days, from a visible feed of ' . count($dates) . ' posts.',
                    ['network' => $label, 'n' => (string) $recent],
                    [['label' => 'Posts in 90 days', 'value' => (string) $recent]]
                );
            }

            $gapStats = self::gapStats($dates);
            if ($gapStats !== null && $gapStats['cv'] > 1.0 && count($dates) >= 5) {
                $findings[] = Rules::make(
                    'sm-irregular-cadence',
                    $label . ' posts land ' . round($gapStats['mean']) . ' days apart on average, but the gap swings from '
                        . $gapStats['min'] . ' to ' . $gapStats['max'] . ' days.',
                    ['network' => $label],
                    [['label' => 'Average gap', 'value' => round($gapStats['mean']) . ' days'],
                     ['label' => 'Range', 'value' => $gapStats['min'] . '–' . $gapStats['max'] . ' days']]
                );
            }

            // series naming — a weak but real signal of format discipline
            if (!empty($feed['titles']) && count($feed['titles']) >= 6) {
                $coverage['visual-consistency'] = 'auto';
                if (!self::hasSeriesPattern($feed['titles'])) {
                    $findings[] = Rules::make(
                        'sm-title-drift',
                        'None of the last ' . count($feed['titles']) . ' ' . $label . ' posts share a prefix, tag or naming pattern.',
                        [],
                        array_map(static fn($t) => ['label' => 'Recent post', 'value' => mb_substr((string) $t, 0, 60)], array_slice($feed['titles'], 0, 3))
                    );
                }
            }

            // engagement, where the feed exposes it
            if (!empty($feed['views']) && !empty($p['followers'])) {
                $coverage['engagement'] = 'auto';
                $avgViews  = array_sum($feed['views']) / max(1, count($feed['views']));
                $followers = (int) $p['followers'];
                $rate      = $followers > 0 ? $avgViews / $followers : 0;
                if ($rate > 0 && $rate < 0.05) {
                    $findings[] = Rules::make(
                        'sm-flat-reach',
                        $label . ' averages ' . number_format($avgViews) . ' views per post against ' . number_format($followers)
                            . ' subscribers — ' . round($rate * 100, 1) . '% of the audience.',
                        ['network' => $label],
                        [['label' => 'Average views', 'value' => number_format($avgViews)],
                         ['label' => 'Followers', 'value' => number_format($followers)],
                         ['label' => 'Reach', 'value' => round($rate * 100, 1) . '%']]
                    );
                }
            }
        }

        // ==================================================== visual consistency
        if (count($avatars) >= 2) {
            $sizes = array_filter(array_map(static fn($net) => $profiles[$net]['avatar_hash'] ?? '', array_keys($avatars)));
            if (count(array_unique($sizes)) > 1 && count($sizes) === count($avatars)) {
                $coverage['visual-consistency'] = 'auto';
                $findings[] = Rules::make(
                    'sm-avatar-drift',
                    'The profile images on ' . implode(' and ', array_map(static fn($n) => self::NETWORKS[$n] ?? $n, array_keys($avatars)))
                        . ' are different files, not one lockup exported twice.',
                    [],
                    array_map(static fn($net, $u) => ['label' => self::NETWORKS[$net] ?? $net, 'value' => 'avatar', 'url' => $u], array_keys($avatars), $avatars)
                );
            }
        }

        return [
            'findings' => $findings,
            'coverage' => $coverage,
            'metrics'  => [
                'profiles'  => $profiles,
                'handles'   => $handles,
                'names'     => $names,
                'readable'  => count($readable),
                'supplied'  => count($profiles),
                'blocked'   => count(array_filter($profiles, static fn($p) => ($p['state'] ?? '') === 'blocked')),
                'primary'   => (string) ($in['primary_network'] ?? ''),
            ],
        ];
    }

    /** @param array<int,string> $dates @return array{mean:float,min:int,max:int,cv:float}|null */
    private static function gapStats(array $dates): ?array
    {
        $stamps = array_values(array_filter(array_map(static fn($d) => strtotime((string) $d) ?: 0, $dates)));
        rsort($stamps);
        if (count($stamps) < 3) {
            return null;
        }
        $gaps = [];
        for ($i = 0; $i < count($stamps) - 1; $i++) {
            $gaps[] = (int) round(($stamps[$i] - $stamps[$i + 1]) / 86400);
        }
        $mean = array_sum($gaps) / count($gaps);
        if ($mean <= 0) {
            return null;
        }
        $var = 0.0;
        foreach ($gaps as $g) {
            $var += ($g - $mean) ** 2;
        }
        $sd = sqrt($var / count($gaps));
        return ['mean' => $mean, 'min' => min($gaps), 'max' => max($gaps), 'cv' => $sd / $mean];
    }

    /** @param array<int,string> $titles */
    private static function hasSeriesPattern(array $titles): bool
    {
        $prefixes = [];
        $tags     = 0;
        foreach ($titles as $t) {
            $t = trim((string) $t);
            if ($t === '') {
                continue;
            }
            if (preg_match('~^([^|:\-–—#]{3,28})\s*[|:\-–—]~u', $t, $m)) {
                $prefixes[mb_strtolower(trim($m[1]))] = ($prefixes[mb_strtolower(trim($m[1]))] ?? 0) + 1;
            }
            if (preg_match('~#\w{3,}~u', $t)) {
                $tags++;
            }
        }
        foreach ($prefixes as $count) {
            if ($count >= 3) {
                return true;
            }
        }
        return $tags >= max(3, (int) floor(count($titles) / 2));
    }

    /** Extract the account handle from a profile URL. */
    public static function handle(string $network, string $url): string
    {
        $path = trim((string) parse_url($url, PHP_URL_PATH), '/');
        if ($path === '') {
            return '';
        }
        $parts = array_values(array_filter(explode('/', $path)));
        if (!$parts) {
            return '';
        }
        if ($network === 'linkedin') {
            if (count($parts) >= 2 && in_array(strtolower($parts[0]), ['company', 'school', 'in', 'showcase'], true)) {
                return strtolower($parts[1]);
            }
            return strtolower($parts[0]);
        }
        if ($network === 'youtube') {
            if (count($parts) >= 2 && in_array(strtolower($parts[0]), ['c', 'channel', 'user'], true)) {
                return strtolower($parts[1]);
            }
            return strtolower(ltrim($parts[0], '@'));
        }
        if ($network === 'facebook' && strtolower($parts[0]) === 'pages' && count($parts) >= 2) {
            return strtolower($parts[1]);
        }
        return strtolower(ltrim(strtok($parts[0], '?') ?: $parts[0], '@'));
    }

    public static function detect(string $url): string
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        $map  = [
            'instagram' => '~(^|\.)instagram\.com$~i',
            'facebook'  => '~(^|\.)facebook\.com$~i',
            'linkedin'  => '~(^|\.)linkedin\.com$~i',
            'youtube'   => '~(^|\.)(youtube\.com|youtu\.be)$~i',
            'x'         => '~(^|\.)(twitter\.com|x\.com)$~i',
        ];
        foreach ($map as $net => $re) {
            if (preg_match($re, $host)) {
                return $net;
            }
        }
        return '';
    }
}
