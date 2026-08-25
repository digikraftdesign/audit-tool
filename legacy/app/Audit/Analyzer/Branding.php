<?php

declare(strict_types=1);

namespace DK\Audit\Analyzer;

use DK\Audit\Rules;

/**
 * Branding audit.
 *
 * Reads the identity across every page it can see: the lockup, the type, the
 * palette, the tone of the copy, whether the stated audience is actually spoken
 * to, how much of it overlaps the named competitors, and whether there is a
 * mission anywhere. Audience and competitor checks depend on what the intake
 * supplied; without those inputs the parameter is handed to the consultant
 * rather than scored on a guess.
 */
final class Branding
{
    /** Phrases every financial brand uses, which therefore differentiate none of them. */
    private const CLICHES = [
        'trusted partner', 'your trusted', 'one stop', 'one-stop', 'seamless experience',
        'cutting edge', 'cutting-edge', 'world class', 'world-class', 'best in class',
        'empowering', 'unlock your', 'take control of your', 'wealth creation journey',
        'financial freedom', 'grow your wealth', 'invest smarter', 'simple, safe',
        'customer centric', 'customer-centric', 'industry leading', 'industry-leading',
        'state of the art', 'end to end', 'end-to-end', 'hassle free', 'hassle-free',
        'next generation', 'next-gen', 'redefining', 'revolutionising', 'revolutionizing',
    ];

    /**
     * @param  array<int,array<string,mixed>>    $pages       page facts
     * @param  string                            $css         concatenated first-party CSS
     * @param  array<string,mixed>               $extra       ['favicon_found'=>bool]
     * @param  array<int,array<string,mixed>>    $competitors competitor page facts + css
     * @param  array<string,mixed>               $in          intake answers
     * @return array{findings:array<int,array<string,mixed>>,coverage:array<string,string>,metrics:array<string,mixed>}
     */
    public static function run(array $pages, string $css, array $extra, array $competitors, array $in): array
    {
        $findings = [];
        $coverage = [
            'visual-identity'    => 'auto',
            'brand-voice'        => 'auto',
            'audience-alignment' => 'manual',
            'uniqueness'         => 'auto',
            'core-values'        => 'auto',
        ];

        $live = array_values(array_filter($pages, static fn($p) => !empty($p['ok'])));
        if (!$live) {
            return ['findings' => [], 'coverage' => $coverage, 'metrics' => []];
        }
        $home    = $live[0];
        $company = trim((string) ($in['company'] ?? ''));

        // ====================================================== visual identity
        $logos = [];
        foreach ($live as $p) {
            foreach ((array) ($p['logos'] ?? []) as $src) {
                $logos[self::assetKey((string) $src)] = (string) $src;
            }
        }
        if (count($logos) > 1) {
            $findings[] = Rules::make(
                'br-multi-logo',
                count($logos) . ' distinct logo files are served across the pages read: '
                    . implode(', ', array_map([self::class, 'shortAsset'], array_slice(array_values($logos), 0, 4))) . '.',
                ['n' => Rules::spell(count($logos))],
                array_map(static fn($u) => ['label' => 'Logo asset', 'value' => self::shortAsset($u), 'url' => $u], array_slice(array_values($logos), 0, 4))
            );
        } elseif (!$logos && !$home['icons'] && trim((string) ($home['og']['image'] ?? '')) === '') {
            $findings[] = Rules::make(
                'br-no-logo',
                'Nothing brand-shaped is declared: no image named as a logo in the masthead, no icon link and no share image.',
                [], [['label' => 'Pages checked', 'value' => (string) count($live)]]
            );
        }

        if (!$home['icons'] && empty($extra['favicon_found'])) {
            $findings[] = Rules::make(
                'br-no-favicon',
                'No icon link tag on the entry page and no /favicon.ico at the root.',
                [], [['label' => 'Checked', 'value' => 'link[rel*=icon] and /favicon.ico']]
            );
        }

        $noOg = [];
        foreach ($live as $p) {
            if (trim((string) ($p['og']['image'] ?? '')) === '') {
                $noOg[] = self::pagePath($p);
            }
        }
        if ($noOg) {
            $findings[] = Rules::make(
                'br-no-og-image',
                count($noOg) . ' of ' . count($live) . ' pages declare no og:image, so shares and paid previews fall back to whatever the platform scrapes: '
                    . implode(', ', array_slice($noOg, 0, 4)) . '.',
                ['n' => (string) count($noOg)],
                array_map(static fn($p) => ['label' => 'No share image', 'value' => $p], array_slice($noOg, 0, 4))
            );
        }

        $families = self::fontFamilies($css, $live);
        if (count($families) > 3) {
            $findings[] = Rules::make(
                'br-type-sprawl',
                count($families) . ' type families are referenced in the CSS the site loads: ' . implode(', ', array_slice($families, 0, 6)) . '.',
                ['n' => Rules::spell(count($families))],
                array_map(static fn($f) => ['label' => 'Family', 'value' => $f], array_slice($families, 0, 6))
            );
        }

        $palette = self::palette($css);
        if (count($palette['accents']) > 8) {
            $findings[] = Rules::make(
                'br-palette-sprawl',
                count($palette['accents']) . ' saturated colours appear in the stylesheet: ' . implode(' ', array_slice($palette['accents'], 0, 8)) . '.',
                ['n' => (string) count($palette['accents'])],
                array_map(static fn($c) => ['label' => 'Colour', 'value' => $c], array_slice($palette['accents'], 0, 8))
            );
        }
        if ($palette['category_only'] && count($palette['accents']) >= 2) {
            $findings[] = Rules::make(
                'br-category-colour',
                'The only saturated colours in the stylesheet sit in the market green / market red range ('
                    . implode(' ', array_slice($palette['accents'], 0, 6)) . ') — the ticker palette every competitor uses.',
                [], array_map(static fn($c) => ['label' => 'Colour', 'value' => $c], array_slice($palette['accents'], 0, 6))
            );
        }

        // =========================================================== brand voice
        $voice = self::voiceStats($live);
        if ($voice['pages'] >= 3 && $voice['sentence_cv'] > 0.45) {
            $findings[] = Rules::make(
                'br-tone-drift',
                'Sentence length swings from ' . round($voice['min_sentence']) . ' to ' . round($voice['max_sentence'])
                    . ' words page to page — the pages do not read as one writer.',
                [],
                [['label' => 'Shortest average', 'value' => round($voice['min_sentence']) . ' words'],
                 ['label' => 'Longest average', 'value' => round($voice['max_sentence']) . ' words']]
            );
        }

        $tagline = self::tagline($live);
        if ($tagline === null) {
            $findings[] = Rules::make(
                'br-no-tagline',
                'No line repeats across the pages read, in a title, an og:title or a headline. There is no sentence the brand owns.',
                [], [['label' => 'Pages compared', 'value' => (string) count($live)]]
            );
        }

        if ($voice['jargon_rate'] > 0.02) {
            $findings[] = Rules::make(
                'br-jargon-heavy',
                round($voice['jargon_rate'] * 1000, 1) . ' category terms per thousand words, led by '
                    . implode(', ', array_slice($voice['jargon_top'], 0, 4)) . '.',
                [], array_map(static fn($j) => ['label' => 'Term', 'value' => $j], array_slice($voice['jargon_top'], 0, 4))
            );
        }

        $variants = self::nameVariants($live, $company);
        if (count($variants) > 2) {
            $findings[] = Rules::make(
                'br-name-drift',
                'The brand name appears as ' . implode(' / ', array_map(static fn($v) => '“' . $v . '”', array_slice($variants, 0, 4)))
                    . ' across page titles, share data and structured data.',
                ['n' => Rules::spell(count($variants))],
                array_map(static fn($v) => ['label' => 'Spelling', 'value' => $v], array_slice($variants, 0, 4))
            );
        }

        // ==================================================== audience alignment
        $audience = trim((string) ($in['audience'] ?? ''));
        if ($audience !== '') {
            $coverage['audience-alignment'] = 'auto';
            $terms = self::audienceTerms($audience);
            $body  = mb_strtolower(implode(' ', array_map(static fn($p) => (string) ($p['text'] ?? ''), $live)));

            $hits   = [];
            $missed = [];
            foreach ($terms as $term) {
                if ($term === '') {
                    continue;
                }
                if (mb_strpos($body, $term) !== false) {
                    $hits[] = $term;
                } else {
                    $missed[] = $term;
                }
            }
            if ($terms && !$hits) {
                $findings[] = Rules::make(
                    'br-audience-absent',
                    'None of the words describing the target audience (' . implode(', ', array_slice($terms, 0, 5))
                        . ') appear anywhere in the copy read.',
                    [], array_map(static fn($t) => ['label' => 'Never mentioned', 'value' => $t], array_slice($missed, 0, 5))
                );
            } elseif ($terms && count($hits) < max(1, (int) ceil(count($terms) / 2))) {
                $findings[] = Rules::make(
                    'br-audience-thin',
                    'Only ' . count($hits) . ' of ' . count($terms) . ' audience themes appear in the copy: '
                        . implode(', ', array_slice($hits, 0, 4)) . '. Missing: ' . implode(', ', array_slice($missed, 0, 4)) . '.',
                    ['n' => (string) count($hits)],
                    array_map(static fn($t) => ['label' => 'Missing theme', 'value' => $t], array_slice($missed, 0, 4))
                );
            }

            $grade = DocumentFile::readability(implode(' ', array_map(static fn($p) => (string) ($p['text'] ?? ''), array_slice($live, 0, 3))));
            if ($grade['grade'] > 13) {
                $findings[] = Rules::make(
                    'br-reading-mismatch',
                    'The site copy reads at roughly grade ' . $grade['grade'] . ', with sentences averaging ' . $grade['avg_sentence'] . ' words.',
                    ['grade' => (string) $grade['grade']],
                    [['label' => 'Reading grade', 'value' => (string) $grade['grade']],
                     ['label' => 'Average sentence', 'value' => $grade['avg_sentence'] . ' words']]
                );
            }
        }

        // ============================================================ uniqueness
        $headlineCopy = mb_strtolower(implode(' ', array_merge(
            array_column($live, 'title'),
            array_map(static fn($p) => implode(' ', (array) $p['h1']), $live)
        )));
        $cliches = [];
        foreach (self::CLICHES as $phrase) {
            if (mb_strpos($headlineCopy, $phrase) !== false) {
                $cliches[] = $phrase;
            }
        }
        if ($cliches) {
            $findings[] = Rules::make(
                'br-cliche',
                'Headline copy leans on ' . implode(', ', array_map(static fn($c) => '“' . $c . '”', array_slice($cliches, 0, 4))) . '.',
                ['n' => (string) count($cliches)],
                array_map(static fn($c) => ['label' => 'Cliché', 'value' => $c], array_slice($cliches, 0, 4))
            );
        }

        foreach ($competitors as $rival) {
            $name = (string) ($rival['host'] ?? 'the competitor');
            $rivalPalette = self::palette((string) ($rival['css'] ?? ''));
            $shared = array_intersect(
                array_map([self::class, 'hueBucket'], $palette['accents']),
                array_map([self::class, 'hueBucket'], $rivalPalette['accents'])
            );
            if (count($shared) >= 2 && $palette['accents'] && $rivalPalette['accents']) {
                $findings[] = Rules::make(
                    'br-palette-overlap',
                    'The palette shares ' . count($shared) . ' hue families with ' . $name . ' ('
                        . implode(' ', array_slice($palette['accents'], 0, 3)) . ' against ' . implode(' ', array_slice($rivalPalette['accents'], 0, 3)) . ').',
                    ['competitor' => $name],
                    [['label' => 'This brand', 'value' => implode(' ', array_slice($palette['accents'], 0, 4))],
                     ['label' => $name, 'value' => implode(' ', array_slice($rivalPalette['accents'], 0, 4))]]
                );
            }

            $rivalFonts = self::fontFamilies((string) ($rival['css'] ?? ''), []);
            $sharedType = array_intersect(array_map('mb_strtolower', $families), array_map('mb_strtolower', $rivalFonts));
            if ($sharedType && $families) {
                $findings[] = Rules::make(
                    'br-type-overlap',
                    'Both brands set type in ' . implode(', ', array_slice($sharedType, 0, 3)) . '.',
                    ['competitor' => $name],
                    [['label' => 'Shared typefaces', 'value' => implode(', ', array_slice($sharedType, 0, 3))]]
                );
            }

            $rivalHeadline = mb_strtolower((string) ($rival['headline'] ?? '') . ' ' . (string) ($rival['title'] ?? ''));
            $ourHeadline   = mb_strtolower((string) ($home['h1'][0] ?? '') . ' ' . (string) $home['title']);
            if ($rivalHeadline !== '' && $ourHeadline !== '' && self::jaccard($ourHeadline, $rivalHeadline) > 0.3) {
                $findings[] = Rules::make(
                    'br-message-overlap',
                    'The headline claim overlaps ' . $name . ': “' . mb_substr(trim($ourHeadline), 0, 60) . '” against “' . mb_substr(trim($rivalHeadline), 0, 60) . '”.',
                    ['competitor' => $name],
                    [['label' => 'This brand', 'value' => mb_substr(trim($ourHeadline), 0, 70)],
                     ['label' => $name, 'value' => mb_substr(trim($rivalHeadline), 0, 70)]]
                );
            }
        }

        // =========================================================== core values
        $allText = mb_strtolower(implode(' ', array_map(static fn($p) => (string) ($p['text'] ?? ''), $live)));
        $mission = self::findStatement($live, '~\b(our mission|our purpose|why we exist|we believe|our vision|we are on a mission)\b~i');
        $values  = (bool) preg_match('~\b(our values|core values|what we stand for|our principles|guiding principles)\b~i', $allText);

        if ($mission === null) {
            $findings[] = Rules::make(
                'br-no-mission',
                'No mission, purpose or vision statement was found on any of the ' . count($live) . ' pages read.',
                [], [['label' => 'Pages searched', 'value' => (string) count($live)]]
            );
        } elseif (self::isGenericMission($mission)) {
            $findings[] = Rules::make(
                'br-mission-generic',
                'The mission reads “' . mb_substr($mission, 0, 140) . '” — no customer, no category and no specific claim in it.',
                [], [['label' => 'Mission', 'value' => mb_substr($mission, 0, 160)]]
            );
        }
        if (!$values) {
            $findings[] = Rules::make(
                'br-no-values',
                'No section names the company values or principles.',
                [], [['label' => 'Pages searched', 'value' => (string) count($live)]]
            );
        }

        return [
            'findings' => $findings,
            'coverage' => $coverage,
            'metrics'  => [
                'logos'       => array_values($logos),
                'families'    => $families,
                'accents'     => $palette['accents'],
                'og_missing'  => count($noOg),
                'tagline'     => $tagline,
                'voice'       => $voice,
                'name_variants' => $variants,
                'cliches'     => $cliches,
                'mission'     => $mission,
                'values'      => $values,
                'competitors' => array_map(static fn($c) => (string) ($c['host'] ?? ''), $competitors),
                'audience'    => $audience,
                'pages'       => array_map([self::class, 'pagePath'], $live),
            ],
        ];
    }

    // ------------------------------------------------------------------ helpers

    private static function pagePath(array $p): string
    {
        $path = (string) parse_url((string) $p['final_url'], PHP_URL_PATH);
        return $path === '' || $path === '/' ? '/' : rtrim($path, '/');
    }

    private static function assetKey(string $url): string
    {
        if (strpos($url, 'inline-svg:') === 0) {
            return $url;
        }
        return strtolower((string) strtok($url, '?'));
    }

    public static function shortAsset(string $url): string
    {
        if (strpos($url, 'inline-svg:') === 0) {
            return 'inline SVG lockup';
        }
        return basename((string) parse_url($url, PHP_URL_PATH)) ?: $url;
    }

    /** @return array<int,string> */
    public static function fontFamilies(string $css, array $pages): array
    {
        $generic = ['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
            'system-ui', '-apple-system', 'blinkmacsystemfont', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
            'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'apple color emoji',
            'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'sans', 'var', 'emoji'];

        $found = [];
        if (preg_match_all('/font-family\s*:\s*([^;{}]+)/i', $css, $m)) {
            foreach ($m[1] as $stack) {
                $first = self::normaliseFamily(trim(explode(',', $stack)[0]));
                if ($first === '' || in_array(mb_strtolower($first), $generic, true) || self::isIconFont($first)) {
                    continue;
                }
                if (!preg_match('/^[A-Za-z0-9 \-.]{2,40}$/', $first)) {
                    continue;
                }
                $found[mb_strtolower($first)] = $first;
            }
        }
        foreach ($pages as $p) {
            foreach ((array) ($p['stylesheets'] ?? []) as $href) {
                if (preg_match_all('/family=([^&:;]+)/i', (string) $href, $mm)) {
                    foreach ($mm[1] as $fam) {
                        $fam = self::normaliseFamily(trim(str_replace('+', ' ', urldecode($fam))));
                        if ($fam !== '' && !in_array(mb_strtolower($fam), $generic, true) && !self::isIconFont($fam)) {
                            $found[mb_strtolower($fam)] = $fam;
                        }
                    }
                }
            }
        }
        ksort($found);
        return array_values($found);
    }

    private static function isIconFont(string $name): bool
    {
        return (bool) preg_match('~(icon|icomoon|fontello|glyph|symbols?$|dashicons|themify|swiper|slick)~i', $name);
    }

    /** Build tools emit `__Barlow_daff4f`; that is one typeface, not three. */
    private static function normaliseFamily(string $name): string
    {
        $name = trim($name, " \t\n\r\0\x0B\"'");
        if ($name === '' || stripos($name, '_Fallback') !== false) {
            return '';
        }
        $name = ltrim($name, '_');
        $name = preg_replace('/_[0-9a-f]{4,10}$/i', '', $name) ?? $name;
        $name = str_replace('_', ' ', $name);
        return trim(preg_replace('/\s+/', ' ', $name) ?? $name);
    }

    /** @return array{accents:array<int,string>,hues:array<int,int>,category_only:bool} */
    public static function palette(string $css): array
    {
        $counts = [];
        if (preg_match_all('/#([0-9a-f]{3}|[0-9a-f]{6})\b/i', $css, $m)) {
            foreach ($m[1] as $hex) {
                $hex = strtolower($hex);
                if (strlen($hex) === 3) {
                    $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
                }
                $counts['#' . $hex] = ($counts['#' . $hex] ?? 0) + 1;
            }
        }
        if (preg_match_all('/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i', $css, $m, PREG_SET_ORDER)) {
            foreach ($m as $set) {
                $hex = sprintf('#%02x%02x%02x', (int) $set[1], (int) $set[2], (int) $set[3]);
                $counts[$hex] = ($counts[$hex] ?? 0) + 1;
            }
        }

        $accents = [];
        $hues    = [];
        foreach ($counts as $hex => $n) {
            [$h, $s, $l] = self::hexToHsl($hex);
            if ($s < 0.22 || $l < 0.12 || $l > 0.92 || $n < 2) {
                continue;
            }
            $accents[$hex] = $n;
            $bucket        = (int) (floor($h / 15) * 15);
            $hues[$bucket] = ($hues[$bucket] ?? 0) + $n;
        }
        arsort($accents);
        arsort($hues);

        $categoryOnly = false;
        if ($hues) {
            $categoryOnly = true;
            $hasGreen = $hasRed = false;
            foreach (array_keys($hues) as $h) {
                $isGreen = $h >= 90 && $h <= 165;
                $isRed   = $h <= 20 || $h >= 340;
                if (!$isGreen && !$isRed) {
                    $categoryOnly = false;
                }
                $hasGreen = $hasGreen || $isGreen;
                $hasRed   = $hasRed || $isRed;
            }
            $categoryOnly = $categoryOnly && $hasGreen && $hasRed;
        }

        return [
            'accents'       => array_keys(array_slice($accents, 0, 14, true)),
            'hues'          => array_keys($hues),
            'category_only' => $categoryOnly,
        ];
    }

    public static function hueBucket(string $hex): int
    {
        [$h, , ] = self::hexToHsl($hex);
        return (int) (floor($h / 30) * 30);
    }

    /** @return array{0:float,1:float,2:float} */
    private static function hexToHsl(string $hex): array
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) !== 6) {
            return [0.0, 0.0, 0.0];
        }
        $r = hexdec(substr($hex, 0, 2)) / 255;
        $g = hexdec(substr($hex, 2, 2)) / 255;
        $b = hexdec(substr($hex, 4, 2)) / 255;
        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        $l   = ($max + $min) / 2;
        $d   = $max - $min;
        if ($d == 0.0) {
            return [0.0, 0.0, $l];
        }
        $s = $l > 0.5 ? $d / (2 - $max - $min) : $d / ($max + $min);
        if ($max === $r) {
            $h = fmod((($g - $b) / $d + ($g < $b ? 6 : 0)), 6);
        } elseif ($max === $g) {
            $h = ($b - $r) / $d + 2;
        } else {
            $h = ($r - $g) / $d + 4;
        }
        return [$h * 60, $s, $l];
    }

    /** Sentence-length spread and jargon density across the pages. */
    private static function voiceStats(array $pages): array
    {
        $averages = [];
        $jargon   = [];
        $words    = 0;
        $terms    = ['leverage', 'synergy', 'holistic', 'robust', 'seamless', 'bespoke', 'ecosystem',
            'paradigm', 'utilise', 'utilize', 'facilitate', 'optimise', 'optimize', 'innovative',
            'solutions', 'offerings', 'orientation', 'granular', 'scalable', 'disruptive',
            'best-in-class', 'value-added', 'end-to-end', 'state-of-the-art'];

        foreach ($pages as $p) {
            $text = (string) ($p['text'] ?? '');
            if (mb_strlen($text) < 400) {
                continue;
            }
            $stats = DocumentFile::readability($text);
            if ($stats['sentences'] >= 4) {
                $averages[] = $stats['avg_sentence'];
            }
            $words += $stats['words'];
            $low = mb_strtolower($text);
            foreach ($terms as $t) {
                $n = substr_count($low, $t);
                if ($n > 0) {
                    $jargon[$t] = ($jargon[$t] ?? 0) + $n;
                }
            }
        }

        arsort($jargon);
        $mean = $averages ? array_sum($averages) / count($averages) : 0.0;
        $cv   = 0.0;
        if (count($averages) >= 2 && $mean > 0) {
            $var = 0.0;
            foreach ($averages as $a) {
                $var += ($a - $mean) ** 2;
            }
            $cv = sqrt($var / count($averages)) / $mean;
        }

        return [
            'pages'        => count($averages),
            'mean_sentence' => round($mean, 1),
            'min_sentence' => $averages ? min($averages) : 0,
            'max_sentence' => $averages ? max($averages) : 0,
            'sentence_cv'  => round($cv, 2),
            'jargon_rate'  => $words > 0 ? array_sum($jargon) / $words : 0.0,
            'jargon_top'   => array_keys(array_slice($jargon, 0, 6, true)),
            'words'        => $words,
        ];
    }

    /** A line the brand repeats across pages — its positioning statement. */
    private static function tagline(array $pages): ?string
    {
        $candidates = [];
        foreach ($pages as $p) {
            foreach ([(string) ($p['og']['title'] ?? ''), (string) $p['title'], (string) ($p['h1'][0] ?? '')] as $line) {
                foreach (preg_split('/\s+[|\-–—·:]\s+/u', $line) ?: [] as $chunk) {
                    $chunk = trim($chunk);
                    if (mb_strlen($chunk) < 12 || mb_strlen($chunk) > 90) {
                        continue;
                    }
                    $key = mb_strtolower($chunk);
                    $candidates[$key] = ($candidates[$key] ?? 0) + 1;
                }
            }
        }
        arsort($candidates);
        foreach ($candidates as $line => $count) {
            if ($count >= 2) {
                return $line;
            }
        }
        return null;
    }

    /** @return array<int,string> */
    private static function nameVariants(array $pages, string $company): array
    {
        $stem = self::stem($company);
        if ($stem === '') {
            return [];
        }
        $variants = [];
        foreach ($pages as $p) {
            $bits = [(string) ($p['og']['site_name'] ?? '')];
            foreach ((array) ($p['jsonld']['org_names'] ?? []) as $n) {
                $bits[] = (string) $n;
            }
            foreach (preg_split('/\s+[|\-–—·:]\s+/u', (string) $p['title']) ?: [] as $chunk) {
                $bits[] = $chunk;
            }
            foreach ($bits as $c) {
                $c = trim(preg_replace('/\s+/u', ' ', $c) ?? '');
                if ($c === '' || mb_strlen($c) > 60 || strpos(self::stem($c), $stem) === false) {
                    continue;
                }
                $variants[mb_strtolower($c)] = $c;
            }
        }
        ksort($variants);
        return array_values($variants);
    }

    private static function stem(string $s): string
    {
        $s = mb_strtolower($s);
        $s = preg_replace('/\b(ltd|limited|pvt|private|inc|llp|plc|co|company|group|india|markets?|capital|securities|broking|financial services)\b/u', ' ', $s) ?? $s;
        $s = preg_replace('/[^a-z0-9]/u', '', $s) ?? $s;
        return mb_substr($s, 0, 12);
    }

    /** @return array<int,string> */
    private static function audienceTerms(string $audience): array
    {
        $stop = ['the', 'and', 'for', 'with', 'who', 'are', 'our', 'that', 'they', 'their', 'from',
            'people', 'customers', 'clients', 'users', 'audience', 'target', 'want', 'need', 'looking'];
        $words = preg_split('/[^a-z0-9]+/i', mb_strtolower($audience)) ?: [];
        $terms = [];
        foreach ($words as $w) {
            if (mb_strlen($w) < 4 || in_array($w, $stop, true)) {
                continue;
            }
            $terms[$w] = true;
        }
        return array_slice(array_keys($terms), 0, 10);
    }

    private static function findStatement(array $pages, string $pattern): ?string
    {
        foreach ($pages as $p) {
            $text = (string) ($p['text'] ?? '');
            if ($text === '' || !preg_match($pattern, $text, $m, PREG_OFFSET_CAPTURE)) {
                continue;
            }
            $from  = (int) $m[0][1];
            $slice = trim(mb_substr(substr($text, $from), 0, 220));
            if ($slice !== '') {
                return $slice;
            }
        }
        return null;
    }

    private static function isGenericMission(string $mission): bool
    {
        $t = mb_strtolower($mission);
        foreach (self::CLICHES as $phrase) {
            if (mb_strpos($t, $phrase) !== false) {
                return true;
            }
        }
        return mb_strlen($t) < 60;
    }

    private static function jaccard(string $a, string $b): float
    {
        $stop = ['the', 'and', 'for', 'with', 'your', 'you', 'our', 'from', 'that', 'this', 'are', 'best'];
        $tok  = static function (string $s) use ($stop): array {
            $w = preg_split('/[^a-z0-9]+/i', mb_strtolower($s)) ?: [];
            return array_values(array_unique(array_filter($w, static fn($x) => mb_strlen($x) > 3 && !in_array($x, $stop, true))));
        };
        $wa = $tok($a);
        $wb = $tok($b);
        if (!$wa || !$wb) {
            return 0.0;
        }
        $inter = count(array_intersect($wa, $wb));
        $union = count(array_unique(array_merge($wa, $wb)));
        return $union > 0 ? $inter / $union : 0.0;
    }
}
