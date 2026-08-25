<?php

declare(strict_types=1);

namespace DK\Audit\Analyzer;

use DK\Audit\Rules;

/**
 * Landing-page audit.
 *
 * Reads one page the way a paid click reads it, and scores the six parameters
 * that decide whether that click converts. Everything is measured from the page
 * and its stylesheets — nothing is assumed.
 */
final class LandingPage
{
    /**
     * @param  array<string,mixed> $page page facts
     * @param  string              $css  concatenated first-party CSS
     * @param  array<string,mixed> $in   intake answers (goal, source)
     * @return array{findings:array<int,array<string,mixed>>,coverage:array<string,string>,metrics:array<string,mixed>}
     */
    public static function run(array $page, string $css, array $in): array
    {
        $findings = [];
        $coverage = [
            'value-prop' => 'auto', 'cta' => 'auto', 'ux' => 'auto',
            'speed' => 'auto', 'mobile' => 'auto', 'trust' => 'auto',
        ];

        $clientRendered = !empty($page['client_rendered']);
        if ($clientRendered) {
            // The HTML barely exists; message and structure rules cannot speak to it.
            $coverage['value-prop'] = 'manual';
            $coverage['ux']         = 'manual';
            $coverage['cta']        = 'manual';
        }

        $text  = (string) ($page['text'] ?? '');
        $url   = (string) $page['final_url'];
        $proofUrl = ['label' => 'Page', 'value' => self::shortUrl($url), 'url' => $url];

        // ============================================================ value prop
        $h1 = (array) ($page['h1'] ?? []);
        if (!$clientRendered) {
            if (!$h1) {
                $findings[] = Rules::make(
                    'lp-no-h1',
                    'There is no H1 on the page, so nothing states the offer in one line.',
                    [], [$proofUrl]
                );
            } elseif (count($h1) > 1) {
                $findings[] = Rules::make(
                    'lp-multi-h1',
                    count($h1) . ' H1 headings compete: ' . implode(' / ', array_map(
                        static fn($t) => '“' . mb_substr((string) $t, 0, 46) . '”', array_slice($h1, 0, 3)
                    )) . '.',
                    ['n' => Rules::spell(count($h1))],
                    [['label' => 'H1 count', 'value' => (string) count($h1)]]
                );
            }

            $headline = trim((string) ($h1[0] ?? ''));
            if ($headline !== '' && self::isVague($headline)) {
                $findings[] = Rules::make(
                    'lp-vague-headline',
                    'The headline reads “' . $headline . '” — no product, no audience and no outcome in it.',
                    [], [['label' => 'Headline', 'value' => $headline]]
                );
            }

            $title = trim((string) $page['title']);
            if ($headline !== '' && $title !== '' && self::overlap($headline, $title) < 0.25) {
                $findings[] = Rules::make(
                    'lp-headline-title-mismatch',
                    'The search title says “' . mb_substr($title, 0, 60) . '” while the page headline says “' . mb_substr($headline, 0, 60) . '”.',
                    [], [['label' => 'Title', 'value' => $title], ['label' => 'Headline', 'value' => $headline]]
                );
            }

            if ($headline !== '' && !(array) ($page['paragraph_words'] ?? [])) {
                $findings[] = Rules::make(
                    'lp-no-subhead',
                    'No supporting paragraph follows the headline anywhere on the page.',
                    [], [$proofUrl]
                );
            }
        }

        if (trim((string) $page['description']) === '' || trim((string) ($page['og']['title'] ?? '')) === '') {
            $missing = [];
            if (trim((string) $page['description']) === '') {
                $missing[] = 'meta description';
            }
            if (trim((string) ($page['og']['title'] ?? '')) === '') {
                $missing[] = 'og:title';
            }
            if (trim((string) ($page['og']['image'] ?? '')) === '') {
                $missing[] = 'og:image';
            }
            $findings[] = Rules::make(
                'lp-meta-thin',
                'The page is missing its ' . implode(' and ', $missing) . ', so search and social render the preview from whatever they can scrape.',
                [], array_map(static fn($m) => ['label' => 'Missing', 'value' => $m], $missing)
            );
        }

        // =================================================================== CTA
        $ctas   = (array) ($page['ctas'] ?? []);
        $strong = array_values(array_filter($ctas, static fn($c) => !empty($c['strong'])));
        $hero   = array_values(array_filter($strong, static fn($c) => !empty($c['hero'])));
        $unique = [];
        foreach ($hero as $c) {
            $key = mb_strtolower(trim((string) $c['text']));
            $dupe = false;
            foreach (array_keys($unique) as $seen) {
                if (strpos($seen, $key) !== false || strpos($key, $seen) !== false) {
                    $dupe = true;
                    break;
                }
            }
            if (!$dupe) {
                $unique[$key] = (string) $c['text'];
            }
        }

        if (!$clientRendered) {
            if (!$hero && !$strong) {
                $findings[] = Rules::make(
                    'lp-no-cta',
                    'No button or link on the page asks for the conversion. The strongest actions found were '
                        . (count($ctas) ? implode(', ', array_map(static fn($c) => '“' . $c['text'] . '”', array_slice($ctas, 0, 3))) : 'none at all') . '.',
                    [], [$proofUrl]
                );
            } elseif (!$hero && $strong) {
                $depth = (int) round(min(1, ($strong[0]['order'] ?? 40) / max(1, count($ctas) + 20)) * 100);
                $findings[] = Rules::make(
                    'lp-cta-below-fold',
                    'The first conversion action, “' . $strong[0]['text'] . '”, only appears after the first section heading.',
                    ['depth' => (string) max(35, $depth)],
                    [['label' => 'First CTA', 'value' => (string) $strong[0]['text']]]
                );
            } elseif (count($unique) >= 3) {
                $labels = array_slice(array_values($unique), 0, 5);
                $findings[] = Rules::make(
                    'lp-cta-collision',
                    'The top of the page offers ' . implode(', ', array_map(static fn($l) => '“' . $l . '”', $labels))
                        . '. They sit in the same band, so the eye has to choose.',
                    ['n' => Rules::spell(count($unique))],
                    [['label' => 'Competing actions', 'value' => implode(' · ', $labels), 'url' => $url]]
                );
            }

            if ($strong && count($strong) === 1 && (int) $page['text_len'] > 4000) {
                $findings[] = Rules::make(
                    'lp-cta-not-repeated',
                    'The page runs ' . number_format((int) $page['text_len']) . ' characters with a single conversion action on it.',
                    [], [['label' => 'Page length', 'value' => number_format((int) $page['text_len']) . ' characters']]
                );
            }

            foreach ($ctas as $c) {
                if (preg_match('~^(submit|click here|learn more|know more|read more|continue)$~i', trim((string) $c['text']))) {
                    $findings[] = Rules::make(
                        'lp-cta-vague',
                        'A primary-looking control is labelled “' . $c['text'] . '”, which names no outcome.',
                        ['label' => (string) $c['text']],
                        [['label' => 'Label', 'value' => (string) $c['text']]]
                    );
                    break;
                }
            }
        }

        $contrast = self::ctaContrast((string) ($page['cta_classes'] ?? ''), $css);
        if ($contrast !== null && $contrast['ratio'] < 4.5) {
            $findings[] = Rules::make(
                'lp-cta-low-contrast',
                'The primary button renders ' . $contrast['fg'] . ' on ' . $contrast['bg'] . ' — a contrast ratio of '
                    . number_format($contrast['ratio'], 1) . ':1, below the 4.5:1 minimum.',
                ['ratio' => number_format($contrast['ratio'], 1)],
                [
                    ['label' => 'Text', 'value' => $contrast['fg']],
                    ['label' => 'Background', 'value' => $contrast['bg']],
                    ['label' => 'Ratio', 'value' => number_format($contrast['ratio'], 1) . ':1'],
                ]
            );
        }

        // ==================================================================== UX
        if (!$clientRendered) {
            $navLinks = (int) ($page['nav_link_count'] ?? 0);
            if ($navLinks > 18) {
                $findings[] = Rules::make(
                    'lp-nav-overload',
                    $navLinks . ' links sit in the header and navigation of a page whose job is one conversion.',
                    ['n' => (string) $navLinks],
                    [['label' => 'Header/nav links', 'value' => (string) $navLinks]]
                );
            }

            if ((int) ($page['h2_count'] ?? 0) === 0 && (int) $page['text_len'] > 1500) {
                $findings[] = Rules::make(
                    'lp-heading-gaps',
                    'The page carries ' . number_format((int) $page['text_len']) . ' characters and not one H2 to break it up.',
                    [], [['label' => 'H2 count', 'value' => '0']]
                );
            }

            $paras = (array) ($page['paragraph_words'] ?? []);
            if ($paras) {
                $longest = max($paras);
                $avg     = array_sum($paras) / count($paras);
                if ($longest > 120 || $avg > 70) {
                    $findings[] = Rules::make(
                        'lp-wall-of-text',
                        'The longest paragraph runs ' . $longest . ' words and the average is ' . round($avg) . '.',
                        ['words' => (string) $longest],
                        [
                            ['label' => 'Longest paragraph', 'value' => $longest . ' words'],
                            ['label' => 'Average', 'value' => round($avg) . ' words'],
                        ]
                    );
                }
            }

            $words = max(1, (int) round((int) $page['text_len'] / 5.5));
            $links = max(1, (int) $page['link_count']);
            $ratio = (int) round($words / $links);
            if ($ratio > 0 && $ratio < 12 && $links > 25) {
                $findings[] = Rules::make(
                    'lp-link-density',
                    $links . ' links against roughly ' . number_format($words) . ' words of copy.',
                    ['ratio' => (string) $ratio],
                    [['label' => 'Links', 'value' => (string) $links], ['label' => 'Words', 'value' => number_format($words)]]
                );
            }
        }

        $maxFields = 0;
        foreach ((array) ($page['forms'] ?? []) as $f) {
            $maxFields = max($maxFields, (int) $f['fields']);
        }
        if ($maxFields > 6) {
            $findings[] = Rules::make(
                'lp-form-friction',
                'The longest form on the page asks for ' . $maxFields . ' fields before the visitor gets anything back.',
                ['fields' => (string) $maxFields],
                [['label' => 'Fields', 'value' => (string) $maxFields]]
            );
        }

        // ================================================================= speed
        $ttfb = (float) $page['ttfb'];
        if ($ttfb >= 0.8) {
            $findings[] = Rules::make(
                'lp-slow-ttfb',
                'The page took ' . number_format($ttfb, 2) . 's to return its first byte, measured from this server.',
                ['ttfb' => number_format($ttfb, 2)],
                [['label' => 'TTFB', 'value' => number_format($ttfb, 2) . 's'], $proofUrl],
                $ttfb >= 1.5 ? 'high' : 'medium'
            );
        }

        $htmlBytes = (int) $page['bytes'];
        if ($htmlBytes > 500000) {
            $findings[] = Rules::make(
                'lp-heavy-html',
                'The page transfers ' . self::bytes($htmlBytes) . ' of HTML before any image or script is counted.',
                ['weight' => self::bytes($htmlBytes)],
                [['label' => 'HTML transferred', 'value' => self::bytes($htmlBytes)]],
                $htmlBytes > 1200000 ? 'high' : 'medium'
            );
        }

        $assets = (int) $page['image_count'] + (int) $page['scripts'] + count((array) $page['stylesheets']);
        if ($assets > 60) {
            $findings[] = Rules::make(
                'lp-many-requests',
                $assets . ' assets are referenced: ' . (int) $page['image_count'] . ' images, '
                    . (int) $page['scripts'] . ' scripts and ' . count((array) $page['stylesheets']) . ' stylesheets.',
                ['n' => (string) $assets],
                [
                    ['label' => 'Images', 'value' => (string) (int) $page['image_count']],
                    ['label' => 'Scripts', 'value' => (string) (int) $page['scripts']],
                    ['label' => 'Stylesheets', 'value' => (string) count((array) $page['stylesheets'])],
                ]
            );
        }

        $blocking = (int) ($page['scripts_blocking'] ?? 0);
        if ($blocking > 2) {
            $findings[] = Rules::make(
                'lp-blocking-scripts',
                $blocking . ' scripts load in the head with neither async nor defer, so the browser waits for each one.',
                ['n' => (string) $blocking],
                [['label' => 'Blocking scripts', 'value' => (string) $blocking]]
            );
        }

        $images = (int) $page['image_count'];
        $lazy   = (int) ($page['images_lazy'] ?? 0);
        if ($images >= 12 && $lazy === 0) {
            $findings[] = Rules::make(
                'lp-no-lazyload',
                'All ' . $images . ' images load immediately — not one uses loading="lazy".',
                ['n' => (string) $images],
                [['label' => 'Images', 'value' => (string) $images], ['label' => 'Lazy-loaded', 'value' => '0']]
            );
        }

        // ================================================================ mobile
        if (empty($page['viewport'])) {
            $findings[] = Rules::make(
                'lp-no-viewport',
                'No <meta name="viewport"> tag, so phones render the desktop layout scaled down.',
                [], [$proofUrl]
            );
        }

        $mediaQueries = preg_match_all('~@media[^{]*\(\s*(?:min|max)-width~i', $css);
        if ($css !== '' && $mediaQueries === 0) {
            $findings[] = Rules::make(
                'lp-no-media-queries',
                'None of the ' . number_format(strlen($css)) . ' characters of CSS read contains a width-based media query.',
                [], [['label' => 'CSS read', 'value' => number_format(strlen($css)) . ' characters']]
            );
        }

        $fixed = preg_match_all('~(?:^|[;{])\s*(?:min-)?width\s*:\s*(\d{3,4})px~i', $css, $fm);
        $wide  = 0;
        if ($fixed) {
            foreach ($fm[1] as $w) {
                if ((int) $w >= 480) {
                    $wide++;
                }
            }
        }
        if ($wide > 4) {
            $findings[] = Rules::make(
                'lp-fixed-widths',
                $wide . ' CSS rules set a fixed width of 480px or more, which cannot shrink to a phone.',
                ['n' => (string) $wide],
                [['label' => 'Fixed-width rules', 'value' => (string) $wide]]
            );
        }

        $bodySize = self::bodyFontSize($css);
        if ($bodySize !== null && $bodySize < 16) {
            $findings[] = Rules::make(
                'lp-small-type',
                'Body copy is set at ' . $bodySize . 'px, under the 16px that keeps phones from zooming.',
                ['size' => $bodySize . 'px'],
                [['label' => 'Body font size', 'value' => $bodySize . 'px']]
            );
        }

        // ================================================================= trust
        if (empty($page['https'])) {
            $findings[] = Rules::make(
                'lp-not-https',
                'The page answered over plain HTTP at ' . parse_url($url, PHP_URL_HOST) . '.',
                [], [$proofUrl]
            );
        } elseif ((int) ($page['mixed'] ?? 0) > 0) {
            $n = (int) $page['mixed'];
            $findings[] = Rules::make(
                'lp-mixed-content',
                $n . ' subresource' . ($n === 1 ? '' : 's') . ' on an https page ' . ($n === 1 ? 'is' : 'are') . ' still requested over http://.',
                ['n' => (string) $n],
                [['label' => 'Insecure subresources', 'value' => (string) $n]]
            );
        }

        $trust        = (array) ($page['trust'] ?? []);
        $testimonials = (array) ($page['testimonials'] ?? []);
        $contact      = (array) ($page['contact'] ?? []);
        $hasProof     = $trust || !empty($testimonials['found']) || (int) ($page['policy_links'] ?? 0) > 0;

        if (!$hasProof) {
            $findings[] = Rules::make(
                'lp-no-trust-markers',
                'No regulator, registration number, review, testimonial, rating or policy link appears anywhere on the page.',
                [], [$proofUrl]
            );
        } else {
            if ($trust) {
                $first = min($trust);
                $key   = array_search($first, $trust, true);
                if ($first > 0.55) {
                    $findings[] = Rules::make(
                        'lp-trust-buried',
                        'The first regulatory marker ("' . $key . '") appears ' . round($first * 100) . '% of the way down the page.',
                        ['depth' => (string) round($first * 100)],
                        [['label' => 'First marker', 'value' => $key . ' at ' . round($first * 100) . '% depth']]
                    );
                }
            }
            if (empty($testimonials['found'])) {
                $findings[] = Rules::make(
                    'lp-no-testimonials',
                    'No testimonial, review count, rating or customer quote was found on the page.',
                    [], [$proofUrl]
                );
            }
        }

        if (($contact['tel'] ?? '') === '' && ($contact['email'] ?? '') === '' && empty($contact['address'])) {
            $findings[] = Rules::make(
                'lp-no-contact',
                'No phone number, email address or postal address appears on the page.',
                [], [$proofUrl]
            );
        }

        return [
            'findings' => $findings,
            'coverage' => $coverage,
            'metrics'  => [
                'url'             => $url,
                'ttfb'            => round($ttfb, 3),
                'html_bytes'      => $htmlBytes,
                'assets'          => $assets,
                'hero_ctas'       => count($unique),
                'nav_links'       => (int) ($page['nav_link_count'] ?? 0),
                'body_font_size'  => $bodySize,
                'media_queries'   => $mediaQueries,
                'contrast'        => $contrast,
                'trust_signals'   => array_keys($trust),
                'testimonials'    => $testimonials,
                'contact'         => $contact,
                'client_rendered' => $clientRendered,
                'goal'            => (string) ($in['goal'] ?? ''),
                'source'          => (string) ($in['source'] ?? ''),
            ],
        ];
    }

    // ------------------------------------------------------------------ helpers

    private static function isVague(string $headline): bool
    {
        $t = mb_strtolower(trim($headline));
        if (mb_strlen($t) < 12) {
            return true;
        }
        $empty = ['welcome', 'home', 'our services', 'about us', 'we are', 'your partner',
            'trusted partner', 'the future of', 'empowering', 'one stop', 'best in class',
            'world class', 'leading provider', 'solutions for'];
        foreach ($empty as $phrase) {
            if (strpos($t, $phrase) !== false && mb_strlen($t) < 60) {
                return true;
            }
        }
        // No noun of substance: no numbers, no product word, very short.
        return !preg_match('/\d/', $t) && count(preg_split('/\s+/u', $t) ?: []) <= 3;
    }

    private static function overlap(string $a, string $b): float
    {
        $wa = array_filter(preg_split('/\W+/u', mb_strtolower($a)) ?: [], static fn($w) => mb_strlen($w) > 3);
        $wb = array_filter(preg_split('/\W+/u', mb_strtolower($b)) ?: [], static fn($w) => mb_strlen($w) > 3);
        if (!$wa || !$wb) {
            return 1.0;
        }
        return count(array_intersect($wa, $wb)) / min(count($wa), count($wb));
    }

    /** Read the button's own colours out of the CSS and measure WCAG contrast. */
    private static function ctaContrast(string $classes, string $css): ?array
    {
        $classes = trim($classes);
        if ($classes === '' || $css === '') {
            return null;
        }
        $fg = null;
        $bg = null;
        foreach (preg_split('/\s+/', $classes) ?: [] as $class) {
            if ($class === '' || !preg_match('/^[A-Za-z][\w-]{1,40}$/', $class)) {
                continue;
            }
            $pattern = '~\.' . preg_quote($class, '~') . '\s*(?:[,:][^{]*)?\{([^}]{0,700})\}~i';
            if (!preg_match_all($pattern, $css, $blocks)) {
                continue;
            }
            foreach ($blocks[1] as $block) {
                if ($bg === null && preg_match('~background(?:-color)?\s*:\s*([^;]+)~i', $block, $m)) {
                    $bg = self::colorToRgb($m[1]) ?? $bg;
                }
                if ($fg === null && preg_match('~(?<!-)color\s*:\s*([^;]+)~i', $block, $m)) {
                    $fg = self::colorToRgb($m[1]) ?? $fg;
                }
            }
        }
        if (!$fg || !$bg) {
            return null;
        }
        return [
            'fg'    => self::rgbToHex($fg),
            'bg'    => self::rgbToHex($bg),
            'ratio' => self::contrastRatio($fg, $bg),
        ];
    }

    /** @return array{0:int,1:int,2:int}|null */
    private static function colorToRgb(string $value): ?array
    {
        $value = trim(strtolower($value));
        if (preg_match('~#([0-9a-f]{3}|[0-9a-f]{6})\b~', $value, $m)) {
            $hex = $m[1];
            if (strlen($hex) === 3) {
                $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
            }
            return [(int) hexdec(substr($hex, 0, 2)), (int) hexdec(substr($hex, 2, 2)), (int) hexdec(substr($hex, 4, 2))];
        }
        if (preg_match('~rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})~', $value, $m)) {
            return [(int) $m[1], (int) $m[2], (int) $m[3]];
        }
        $named = ['white' => [255, 255, 255], 'black' => [0, 0, 0], 'red' => [255, 0, 0],
            'green' => [0, 128, 0], 'blue' => [0, 0, 255], 'transparent' => null];
        foreach ($named as $name => $rgb) {
            if (strpos($value, $name) === 0) {
                return $rgb;
            }
        }
        return null;
    }

    private static function rgbToHex(array $rgb): string
    {
        return sprintf('#%02x%02x%02x', $rgb[0], $rgb[1], $rgb[2]);
    }

    /** WCAG 2.1 relative-luminance contrast ratio. */
    public static function contrastRatio(array $a, array $b): float
    {
        $lum = static function (array $rgb): float {
            $c = [];
            foreach ($rgb as $v) {
                $s = $v / 255;
                $c[] = $s <= 0.03928 ? $s / 12.92 : pow(($s + 0.055) / 1.055, 2.4);
            }
            return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2];
        };
        $la = $lum($a);
        $lb = $lum($b);
        $hi = max($la, $lb);
        $lo = min($la, $lb);
        return round(($hi + 0.05) / ($lo + 0.05), 2);
    }

    private static function bodyFontSize(string $css): ?int
    {
        if (preg_match('~(?:^|[},])\s*(?:html\s*,?\s*)?body[^{]{0,40}\{([^}]{0,900})\}~i', $css, $m)) {
            if (preg_match('~font-size\s*:\s*([\d.]+)(px|rem|em|%)~i', $m[1], $f)) {
                $n    = (float) $f[1];
                $unit = strtolower($f[2]);
                if ($unit === 'px') {
                    return (int) round($n);
                }
                if ($unit === 'rem' || $unit === 'em') {
                    return (int) round($n * 16);
                }
                if ($unit === '%') {
                    return (int) round($n / 100 * 16);
                }
            }
        }
        return null;
    }

    public static function bytes(int $n): string
    {
        if ($n >= 1048576) {
            return number_format($n / 1048576, 1) . ' MB';
        }
        if ($n >= 1024) {
            return number_format($n / 1024, 0) . ' KB';
        }
        return $n . ' B';
    }

    public static function shortUrl(string $url): string
    {
        return preg_replace('~^https?://~', '', rtrim($url, '/')) ?: $url;
    }
}
