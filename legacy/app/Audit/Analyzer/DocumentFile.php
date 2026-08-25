<?php

declare(strict_types=1);

namespace DK\Audit\Analyzer;

use DK\Audit\Rules;
use DK\Support\Pdf;

/**
 * Document audit.
 *
 * Scores a real file — uploaded or fetched — on clarity, actionability,
 * accuracy, visual design and accessibility. The accuracy pass is a mechanical
 * one (placeholders, doubled words, known misspellings, spacing); it is called
 * that in the evidence rather than being dressed up as a proofread.
 */
final class DocumentFile
{
    /** Words people habitually get wrong, worth catching in client-facing files. */
    private const MISSPELLINGS = [
        'seperate' => 'separate', 'occured' => 'occurred', 'recieve' => 'receive',
        'accomodate' => 'accommodate', 'existance' => 'existence', 'refered' => 'referred',
        'sucessful' => 'successful', 'succesful' => 'successful', 'garantee' => 'guarantee',
        'guarentee' => 'guarantee', 'maintenence' => 'maintenance', 'neccessary' => 'necessary',
        'occassion' => 'occasion', 'priviledge' => 'privilege', 'reccomend' => 'recommend',
        'recomend' => 'recommend', 'refrence' => 'reference', 'responsable' => 'responsible',
        'similiar' => 'similar', 'begining' => 'beginning', 'commited' => 'committed',
        'definately' => 'definitely', 'independant' => 'independent', 'liase' => 'liaise',
        'occurance' => 'occurrence', 'publically' => 'publicly', 'seperately' => 'separately',
        'acknowledgement' => 'acknowledgment', 'withdrawl' => 'withdrawal', 'benificiary' => 'beneficiary',
        'disbursment' => 'disbursement', 'instalment' => 'installment', 'compliancce' => 'compliance',
    ];

    private const PLACEHOLDERS = [
        'lorem ipsum', 'dolor sit amet', 'tbd', 'to be decided', 'xxxx', 'xxx,',
        '[insert', '[name]', '[date]', '[client]', '<insert', 'placeholder text',
        'your text here', 'sample text', 'todo:', 'fixme',
    ];

    /**
     * @param  array<string,mixed> $doc  DocText::read() output
     * @param  array<string,mixed> $file ['name'=>, 'bytes'=>, 'source'=>, 'url'=>]
     * @param  array<string,mixed> $in   intake answers (doc_kind, audience, brand)
     * @return array{findings:array<int,array<string,mixed>>,coverage:array<string,string>,metrics:array<string,mixed>}
     */
    public static function run(array $doc, array $file, array $in): array
    {
        $findings = [];
        $coverage = [
            'clarity' => 'auto', 'actionability' => 'auto', 'accuracy' => 'auto',
            'visual-design' => 'auto', 'accessibility' => 'auto',
        ];

        $name  = (string) ($file['name'] ?? 'document');
        $proof = ['label' => 'File', 'value' => $name];
        if (!empty($file['url'])) {
            $proof['url'] = (string) $file['url'];
        }

        // ---------------------------------------------------- nothing to read
        if (empty($doc['ok']) || (int) $doc['words'] < 25) {
            $findings[] = Rules::make(
                'doc-no-text',
                $doc['error'] !== ''
                    ? (string) $doc['error']
                    : 'Only ' . (int) $doc['words'] . ' words of text could be extracted, so the file is almost certainly a set of images.',
                [], [$proof]
            );
            // Everything that needs the words cannot be scored automatically.
            $coverage['clarity']       = 'auto';   // the finding above is the score
            $coverage['actionability'] = 'manual';
            $coverage['accuracy']      = 'manual';
            $coverage['accessibility'] = 'manual';
            return [
                'findings' => $findings,
                'coverage' => $coverage,
                'metrics'  => self::metrics($doc, $file, [], []),
            ];
        }

        $text       = (string) $doc['text'];
        $lower      = mb_strtolower($text);
        $words      = (int) $doc['words'];
        $headings   = (array) $doc['headings'];
        $paragraphs = (array) $doc['paragraphs'];
        $stats      = self::readability($text);

        // ============================================================== clarity
        if (!$headings && $words > 250) {
            $findings[] = Rules::make(
                'doc-no-headings',
                'No heading of any kind breaks up ' . number_format($words) . ' words.',
                ['words' => number_format($words)],
                [['label' => 'Words', 'value' => number_format($words)], ['label' => 'Headings', 'value' => '0']]
            );
        }
        if ($stats['avg_sentence'] > 25) {
            $findings[] = Rules::make(
                'doc-long-sentences',
                'Sentences average ' . round($stats['avg_sentence']) . ' words, and the longest runs ' . $stats['max_sentence'] . '.',
                ['n' => (string) round($stats['avg_sentence'])],
                [
                    ['label' => 'Average sentence', 'value' => round($stats['avg_sentence']) . ' words'],
                    ['label' => 'Longest sentence', 'value' => $stats['max_sentence'] . ' words'],
                ],
                $stats['avg_sentence'] > 32 ? 'high' : 'medium'
            );
        }
        if ($paragraphs) {
            $paraWords = array_map(static fn($p) => count(preg_split('/\s+/u', $p) ?: []), $paragraphs);
            $avgPara   = array_sum($paraWords) / count($paraWords);
            $maxPara   = max($paraWords);
            if ($maxPara > 140 || $avgPara > 90) {
                $findings[] = Rules::make(
                    'doc-long-paragraphs',
                    'The longest block runs ' . $maxPara . ' words with an average of ' . round($avgPara) . '.',
                    ['n' => (string) $maxPara],
                    [['label' => 'Longest block', 'value' => $maxPara . ' words'], ['label' => 'Average', 'value' => round($avgPara) . ' words']]
                );
            }
        }
        if ((int) $doc['list_items'] === 0 && $words > 400) {
            $findings[] = Rules::make(
                'doc-no-lists',
                'Nothing in ' . number_format($words) . ' words is set as a bulleted or numbered list.',
                [], [['label' => 'List items', 'value' => '0']]
            );
        }
        if ($stats['grade'] > 14) {
            $findings[] = Rules::make(
                'doc-hard-reading',
                'A Flesch–Kincaid estimate puts this at grade ' . round($stats['grade'], 1)
                    . ' — roughly ' . ($stats['grade'] >= 16 ? 'postgraduate' : 'late-undergraduate') . ' reading.',
                ['grade' => (string) round($stats['grade'], 1)],
                [
                    ['label' => 'Reading grade', 'value' => (string) round($stats['grade'], 1)],
                    ['label' => 'Avg syllables/word', 'value' => (string) round($stats['syllables'], 2)],
                ],
                $stats['grade'] > 17 ? 'high' : 'medium'
            );
        }

        // ======================================================== actionability
        $headingText = mb_strtolower(implode(' | ', array_column($headings, 'text')));
        $hasSummary  = (bool) preg_match('~\b(summary|overview|at a glance|key takeaways?|executive summary|in short|highlights)\b~', $headingText . ' ' . $lower);
        $hasNext     = (bool) preg_match('~\b(next steps?|what happens next|how to (apply|start|proceed|open)|action(s| items| required)|to get started|follow(-| )up|checklist)\b~', $lower);
        $hasContact  = (bool) preg_match('~[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b(?:\+91[\s-]?)?[6-9]\d{9}\b|\bcontact us\b|\bcall us\b~i', $text);
        $hasCta      = (bool) preg_match('~\b(open an account|get started|apply now|book a|schedule a|scan the|visit |download the|sign up|talk to|reach out|write to us)\b~', $lower);

        if (!$hasSummary && $words > 400) {
            $findings[] = Rules::make(
                'doc-no-summary',
                'No section reads as a summary, overview or set of key takeaways anywhere in ' . number_format($words) . ' words.',
                [], [['label' => 'Headings searched', 'value' => (string) count($headings)]]
            );
        }
        if (!$hasNext) {
            $findings[] = Rules::make(
                'doc-no-next-steps',
                'The text never names a next step — no "next steps", "how to apply", action list or checklist.',
                [], [$proof]
            );
        }
        if (!$hasContact) {
            $findings[] = Rules::make(
                'doc-no-contact',
                'No email address, phone number or contact instruction appears in the document.',
                [], [$proof]
            );
        }
        if (!$hasCta) {
            $findings[] = Rules::make(
                'doc-no-cta',
                'Nothing in the copy asks the reader to do anything.',
                [], [$proof]
            );
        }

        // ============================================================= accuracy
        $found = [];
        foreach (self::PLACEHOLDERS as $needle) {
            if (strpos($lower, $needle) !== false) {
                $found[] = $needle;
            }
        }
        if ($found) {
            $findings[] = Rules::make(
                'doc-placeholders',
                'Unfinished text is still in the file: ' . implode(', ', array_map(static fn($f) => '“' . $f . '”', array_slice($found, 0, 4))) . '.',
                [], array_map(static fn($f) => ['label' => 'Placeholder', 'value' => $f], array_slice($found, 0, 4))
            );
        }

        $doubled = [];
        if (preg_match_all('~\b(\w{3,})\s+\1\b~iu', $text, $m, PREG_SET_ORDER)) {
            foreach (array_slice($m, 0, 6) as $hit) {
                $doubled[] = trim($hit[0]);
            }
        }
        if (count($doubled) >= 2) {
            $findings[] = Rules::make(
                'doc-repeated-words',
                'Doubled words appear in the text: ' . implode(', ', array_map(static fn($d) => '“' . $d . '”', array_slice($doubled, 0, 4))) . '.',
                ['n' => (string) count($doubled)],
                array_map(static fn($d) => ['label' => 'Doubled', 'value' => $d], array_slice($doubled, 0, 4))
            );
        }

        $misspelled = [];
        foreach (self::MISSPELLINGS as $wrong => $right) {
            if (preg_match('~\b' . preg_quote($wrong, '~') . '\b~iu', $text)) {
                $misspelled[] = $wrong . ' → ' . $right;
            }
        }
        if ($misspelled) {
            $findings[] = Rules::make(
                'doc-misspellings',
                'A mechanical check against a list of commonly-confused spellings flagged: '
                    . implode(', ', array_slice($misspelled, 0, 4)) . '. This is not a full proofread.',
                ['n' => (string) count($misspelled)],
                array_map(static fn($m2) => ['label' => 'Spelling', 'value' => $m2], array_slice($misspelled, 0, 5))
            );
        }

        $spacing = 0;
        $spacing += preg_match_all('~\s[,.;:]~u', $text);
        $spacing += preg_match_all('~[a-z][,.][A-Za-z]~u', $text);
        $spacing += preg_match_all('~\(\s|\s\)~u', $text);
        if ($spacing >= 6) {
            $findings[] = Rules::make(
                'doc-spacing',
                $spacing . ' places have a space before punctuation, a missing space after it, or stray bracket spacing.',
                ['n' => (string) $spacing],
                [['label' => 'Spacing slips', 'value' => (string) $spacing]]
            );
        }

        $brand = trim((string) ($in['brand'] ?? ''));
        if ($brand !== '') {
            $variants = self::brandVariants($text, $brand);
            if (count($variants) > 1) {
                $findings[] = Rules::make(
                    'doc-brand-drift',
                    'The brand appears as ' . implode(' / ', array_map(static fn($v) => '“' . $v . '”', array_slice($variants, 0, 4))) . ' in the same file.',
                    ['n' => Rules::spell(count($variants))],
                    array_map(static fn($v) => ['label' => 'Spelling', 'value' => $v], array_slice($variants, 0, 4))
                );
            }
        }

        $date = $doc['modified'] ?: $doc['created'];
        if ($date) {
            $ts = strtotime((string) $date);
            if ($ts) {
                $months = (int) floor((time() - $ts) / (30.44 * 86400));
                if ($months >= 18) {
                    $findings[] = Rules::make(
                        'doc-stale',
                        'The file was last modified ' . $date . ' — ' . self::age($months) . ' ago.',
                        ['date' => (string) $date],
                        [['label' => 'Last modified', 'value' => (string) $date], ['label' => 'Age', 'value' => self::age($months)]],
                        $months >= 30 ? 'high' : 'medium'
                    );
                }
            }
        }

        // ======================================================== visual design
        $fonts = (array) $doc['fonts'];
        if (count($fonts) > 3) {
            $findings[] = Rules::make(
                'doc-font-sprawl',
                count($fonts) . ' typefaces are embedded: ' . implode(', ', array_slice($fonts, 0, 6)) . '.',
                ['n' => Rules::spell(count($fonts))],
                array_map(static fn($f) => ['label' => 'Typeface', 'value' => $f], array_slice($fonts, 0, 6))
            );
        }
        $sizes = array_keys((array) $doc['sizes']);
        if (count($sizes) > 8) {
            sort($sizes, SORT_NUMERIC);
            $findings[] = Rules::make(
                'doc-size-sprawl',
                count($sizes) . ' distinct type sizes are used, from ' . $sizes[0] . 'pt to ' . end($sizes) . 'pt.',
                ['n' => (string) count($sizes)],
                [['label' => 'Distinct sizes', 'value' => (string) count($sizes)],
                 ['label' => 'Range', 'value' => $sizes[0] . 'pt – ' . end($sizes) . 'pt']]
            );
        }
        $tool = trim((string) ($doc['producer'] ?: $doc['creator']));
        if ($tool !== '' && Pdf::isOfficeExport($doc['producer'], $doc['creator'])) {
            $findings[] = Rules::make(
                'doc-office-export',
                'The file was exported straight from ' . $tool . ' with no design layer applied.',
                ['tool' => $tool],
                [['label' => 'Produced with', 'value' => $tool]]
            );
        }
        if (trim((string) $doc['title']) === '') {
            $findings[] = Rules::make(
                'doc-no-title-meta',
                'The file carries no title in its metadata, so it surfaces as “' . $name . '”.',
                [], [$proof]
            );
        }
        $bytes = (int) ($file['bytes'] ?? $doc['bytes']);
        if ($bytes > 5 * 1048576) {
            $findings[] = Rules::make(
                'doc-heavy',
                'The file is ' . LandingPage::bytes($bytes) . ' across ' . ($doc['pages'] ?: '?') . ' pages.',
                ['weight' => LandingPage::bytes($bytes)],
                [['label' => 'File size', 'value' => LandingPage::bytes($bytes)]]
            );
        }

        // ======================================================== accessibility
        $bodySize = (float) $doc['body_size'];
        if ($bodySize > 0 && $bodySize < 9) {
            $findings[] = Rules::make(
                'doc-tiny-type',
                'Most of the text is set at ' . $bodySize . 'pt, below the 9pt floor for readable print.',
                ['size' => (string) $bodySize],
                [['label' => 'Body size', 'value' => $bodySize . 'pt']]
            );
        } elseif ($bodySize === 0.0) {
            // No size information at all (DOCX/HTML without inline sizes).
            $coverage['accessibility'] = 'manual';
        }

        $contrast = self::textContrast((array) $doc['colors']);
        if ($contrast !== null && $contrast['ratio'] < 4.5) {
            $findings[] = Rules::make(
                'doc-low-contrast',
                'The dominant text colour ' . $contrast['fg'] . ' against ' . $contrast['bg'] . ' measures '
                    . number_format($contrast['ratio'], 1) . ':1.',
                ['ratio' => number_format($contrast['ratio'], 1)],
                [['label' => 'Text', 'value' => $contrast['fg']], ['label' => 'Page', 'value' => $contrast['bg']],
                 ['label' => 'Ratio', 'value' => number_format($contrast['ratio'], 1) . ':1']]
            );
        }
        if (trim((string) $doc['lang']) === '') {
            $findings[] = Rules::make(
                'doc-no-lang',
                'No language is declared in the file metadata.',
                [], [$proof]
            );
        }
        if ($doc['kind'] === 'pdf' && empty($doc['tagged'])) {
            $findings[] = Rules::make(
                'doc-untagged',
                'The PDF has no structure tree, so assistive technology reads it as one undifferentiated block.',
                [], [['label' => 'StructTreeRoot', 'value' => 'absent']]
            );
        }

        return [
            'findings' => $findings,
            'coverage' => $coverage,
            'metrics'  => self::metrics($doc, $file, $stats, $contrast ?? []),
        ];
    }

    // ------------------------------------------------------------------ helpers

    private static function metrics(array $doc, array $file, array $stats, array $contrast): array
    {
        return [
            'name'      => (string) ($file['name'] ?? ''),
            'source'    => (string) ($file['source'] ?? ''),
            'url'       => (string) ($file['url'] ?? ''),
            'kind'      => (string) $doc['kind'],
            'bytes'     => (int) ($file['bytes'] ?? $doc['bytes']),
            'pages'     => $doc['pages'],
            'words'     => (int) $doc['words'],
            'headings'  => count((array) $doc['headings']),
            'lists'     => (int) $doc['list_items'],
            'fonts'     => (array) $doc['fonts'],
            'sizes'     => array_slice((array) $doc['sizes'], 0, 10, true),
            'colors'    => array_slice((array) $doc['colors'], 0, 8, true),
            'body_size' => $doc['body_size'],
            'title'     => (string) $doc['title'],
            'producer'  => (string) ($doc['producer'] ?: $doc['creator']),
            'modified'  => $doc['modified'] ?: $doc['created'],
            'lang'      => (string) $doc['lang'],
            'tagged'    => (bool) $doc['tagged'],
            'readability' => $stats,
            'contrast'  => $contrast,
        ];
    }

    /** Flesch–Kincaid grade plus the raw sentence stats behind it. */
    public static function readability(string $text): array
    {
        $sentences = preg_split('/(?<=[.!?])\s+/u', trim($text)) ?: [];
        $sentences = array_values(array_filter($sentences, static fn($s) => count(preg_split('/\s+/u', trim($s)) ?: []) >= 3));
        $words     = preg_split('/\s+/u', trim($text)) ?: [];
        $words     = array_values(array_filter($words, static fn($w) => preg_match('/[a-z]/i', $w)));

        if (!$sentences || !$words) {
            return ['avg_sentence' => 0.0, 'max_sentence' => 0, 'syllables' => 0.0, 'grade' => 0.0, 'sentences' => 0, 'words' => count($words)];
        }

        $lengths   = array_map(static fn($s) => count(preg_split('/\s+/u', trim($s)) ?: []), $sentences);
        $avg       = array_sum($lengths) / count($lengths);
        $syllables = 0;
        foreach ($words as $w) {
            $syllables += self::syllables($w);
        }
        $perWord = $syllables / count($words);
        $grade   = 0.39 * $avg + 11.8 * $perWord - 15.59;

        return [
            'avg_sentence' => round($avg, 1),
            'max_sentence' => max($lengths),
            'syllables'    => round($perWord, 2),
            'grade'        => round(max(0, $grade), 1),
            'sentences'    => count($sentences),
            'words'        => count($words),
        ];
    }

    private static function syllables(string $word): int
    {
        $w = strtolower(preg_replace('/[^a-z]/i', '', $word) ?? '');
        if ($w === '') {
            return 0;
        }
        if (strlen($w) <= 3) {
            return 1;
        }
        $w = preg_replace('/(?:[^laeiouy]es|ed|[^laeiouy]e)$/', '', $w) ?? $w;
        $w = preg_replace('/^y/', '', $w) ?? $w;
        $n = preg_match_all('/[aeiouy]{1,2}/', $w);
        return max(1, (int) $n);
    }

    /** @return array<int,string> */
    private static function brandVariants(string $text, string $brand): array
    {
        $stem = preg_replace('/[^a-z]/i', '', mb_strtolower($brand));
        $stem = mb_substr((string) $stem, 0, 8);
        if (mb_strlen($stem) < 4) {
            return [];
        }
        $pattern = '~\b' . implode('[\s.\-]?', str_split($stem)) . '[A-Za-z]*\b~iu';
        if (!preg_match_all($pattern, $text, $m)) {
            return [];
        }
        $seen = [];
        foreach ($m[0] as $hit) {
            $hit = trim($hit);
            if ($hit !== '') {
                $seen[$hit] = true;   // case and spacing differences are the point
            }
        }
        // Collapse pure case duplicates only when they are identical strings.
        return array_slice(array_keys($seen), 0, 6);
    }

    /** Dominant text colour against the dominant page colour. */
    private static function textContrast(array $colors): ?array
    {
        if (count($colors) < 2) {
            return null;
        }
        arsort($colors);
        $hexes = array_keys($colors);

        // The lightest heavily-used colour is almost always the page/background.
        $bg = null;
        $fg = null;
        foreach ($hexes as $hex) {
            $rgb = self::hexToRgb($hex);
            if ($rgb === null) {
                continue;
            }
            $lum = ($rgb[0] + $rgb[1] + $rgb[2]) / 3;
            if ($bg === null || $lum > $bg['lum']) {
                $bg = ['hex' => $hex, 'rgb' => $rgb, 'lum' => $lum];
            }
            if ($fg === null || $lum < $fg['lum']) {
                $fg = ['hex' => $hex, 'rgb' => $rgb, 'lum' => $lum];
            }
        }
        if (!$bg || !$fg || $bg['hex'] === $fg['hex']) {
            return null;
        }
        return [
            'fg'    => $fg['hex'],
            'bg'    => $bg['hex'],
            'ratio' => LandingPage::contrastRatio($fg['rgb'], $bg['rgb']),
        ];
    }

    /** @return array{0:int,1:int,2:int}|null */
    private static function hexToRgb(string $hex): ?array
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) !== 6 || !ctype_xdigit($hex)) {
            return null;
        }
        return [(int) hexdec(substr($hex, 0, 2)), (int) hexdec(substr($hex, 2, 2)), (int) hexdec(substr($hex, 4, 2))];
    }

    private static function age(int $months): string
    {
        if ($months < 24) {
            return $months . ' months';
        }
        $years = (int) floor($months / 12);
        $rem   = $months % 12;
        return $years . ' year' . ($years === 1 ? '' : 's') . ($rem >= 3 ? ' ' . $rem . ' months' : '');
    }
}
