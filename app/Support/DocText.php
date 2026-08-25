<?php

declare(strict_types=1);

namespace DK\Support;

/**
 * Reads a document into text plus the type and colour facts the audit needs.
 *
 * Supports PDF (including Flate-compressed streams and ToUnicode CMaps), DOCX,
 * HTML and plain text/Markdown. Everything is pure PHP — no shelling out, no
 * extensions beyond zlib and, for DOCX, ZipArchive.
 *
 * Where a file cannot be read (a scanned PDF with no text layer, for instance)
 * the result says so rather than returning an empty string that would look like
 * a clean document.
 */
final class DocText
{
    /**
     * @return array<string,mixed>
     */
    public static function read(string $bytes, string $filename = '', string $contentType = ''): array
    {
        $out = self::blank();
        if ($bytes === '') {
            $out['error'] = 'The file is empty.';
            return $out;
        }

        $ext  = strtolower((string) pathinfo($filename, PATHINFO_EXTENSION));
        $kind = 'text';
        if (strncmp($bytes, '%PDF-', 5) === 0 || $ext === 'pdf' || strpos($contentType, 'pdf') !== false) {
            $kind = 'pdf';
        } elseif (strncmp($bytes, "PK\x03\x04", 4) === 0 && in_array($ext, ['docx', 'pptx', ''], true)) {
            $kind = $ext === 'pptx' ? 'pptx' : 'docx';
        } elseif ($ext === 'html' || $ext === 'htm' || strpos($contentType, 'html') !== false
            || preg_match('~^\s*<(?:!doctype|html)~i', substr($bytes, 0, 200))) {
            $kind = 'html';
        }

        switch ($kind) {
            case 'pdf':
                $out = self::readPdf($bytes);
                break;
            case 'docx':
            case 'pptx':
                $out = self::readOfficeZip($bytes, $kind);
                break;
            case 'html':
                $out = self::readHtml($bytes);
                break;
            default:
                $out = self::readPlain($bytes, $ext);
        }

        $out['kind']  = $kind;
        $out['bytes'] = strlen($bytes);
        return self::finish($out);
    }

    // ==================================================================== PDF

    private static function readPdf(string $bytes): array
    {
        $out = self::blank();
        $out['ok'] = true;

        $meta = Pdf::meta($bytes);
        $out['title']    = (string) ($meta['title'] ?? '');
        $out['producer'] = (string) ($meta['producer'] ?? '');
        $out['creator']  = (string) ($meta['creator'] ?? '');
        $out['created']  = $meta['created'];
        $out['modified'] = $meta['modified'];

        $out['pages']  = self::pdfPageCount($bytes, $meta['pages'] ?? null);
        $out['tagged'] = strpos($bytes, '/StructTreeRoot') !== false;
        if (preg_match('~/Lang\s*\(([^)]{2,12})\)~', $bytes, $m)) {
            $out['lang'] = trim($m[1]);
        }

        $fonts   = self::pdfFonts($bytes);
        $cmaps   = $fonts['cmaps'];
        $streams = self::pdfContentStreams($bytes);
        if (!$streams) {
            $out['error'] = 'No readable content stream — the file is probably scanned images.';
            return $out;
        }

        $runs = [];
        foreach ($streams as $stream) {
            foreach (self::pdfRuns($stream, $cmaps) as $run) {
                $runs[] = $run;
            }
        }
        if (!$runs) {
            $out['error'] = 'No text layer found — the file is a picture of a document.';
            return $out;
        }

        // Real typeface names come from /BaseFont, not the /F1 aliases the
        // content stream uses.
        foreach ($fonts['names'] as $name) {
            $out['fonts'][] = self::cleanFontName($name);
        }
        $out['cmapped'] = $cmaps !== [];

        return self::fromRuns($out, $runs, true);
    }

    private static function pdfPageCount(string $bytes, ?int $hint): ?int
    {
        if ($hint) {
            return $hint;
        }
        $n = preg_match_all('~/Type\s*/Page\b(?!s)~', $bytes);
        return $n > 0 ? $n : null;
    }

    /** Inflate every stream that looks like page content. @return array<int,string> */
    private static function pdfContentStreams(string $bytes): array
    {
        $out = [];
        $offset = 0;
        $limit  = 400; // plenty for a long document, bounded for safety

        while (count($out) < $limit && ($start = strpos($bytes, 'stream', $offset)) !== false) {
            $head    = substr($bytes, max(0, $start - 600), 600);
            $dataAt  = $start + 6;
            if (substr($bytes, $dataAt, 2) === "\r\n") {
                $dataAt += 2;
            } elseif ($bytes[$dataAt] === "\n" || $bytes[$dataAt] === "\r") {
                $dataAt += 1;
            }
            $end = strpos($bytes, 'endstream', $dataAt);
            if ($end === false) {
                break;
            }
            $offset = $end + 9;

            $raw = substr($bytes, $dataAt, $end - $dataAt);
            if ($raw === '' || strlen($raw) > 6000000) {
                continue;
            }
            if (strpos($head, '/Image') !== false || strpos($head, '/ToUnicode') !== false) {
                continue;
            }

            if (strpos($head, 'FlateDecode') !== false) {
                $plain = @gzuncompress($raw);
                if ($plain === false) {
                    $plain = @gzinflate($raw);
                }
                if ($plain === false) {
                    $plain = @gzinflate(substr($raw, 2));
                }
                if ($plain === false) {
                    continue;
                }
            } else {
                $plain = $raw;
            }

            if (strpos($plain, 'BT') !== false && (strpos($plain, 'Tj') !== false || strpos($plain, 'TJ') !== false)) {
                $out[] = $plain;
            }
        }

        return $out;
    }

    /**
     * Resolve every font resource name (/F1) to its ToUnicode CMap and its real
     * typeface name.
     *
     * The chain runs resource name -> font object -> ToUnicode object, across
     * three separate PDF objects, so all three have to be walked. Skip it and
     * any subset-embedded font comes out as raw glyph codes.
     *
     * @return array{cmaps:array<string,array<string,string>>,basefonts:array<string,string>,names:array<int,string>}
     */
    private static function pdfFonts(string $bytes): array
    {
        $heads = self::pdfObjectHeads($bytes);

        $fontObjects = [];   // object id => ['base' => name, 'cmap' => object id]
        $names       = [];
        foreach ($heads as $id => $head) {
            if (strpos($head, '/BaseFont') === false) {
                continue;
            }
            $base = '';
            if (preg_match('~/BaseFont\s*/([A-Za-z0-9#+.\-,_]+)~', $head, $m)) {
                $base    = str_replace('#20', ' ', $m[1]);
                $names[] = $base;
            }
            $cmap = 0;
            if (preg_match('~/ToUnicode\s+(\d+)\s+0\s+R~', $head, $m)) {
                $cmap = (int) $m[1];
            }
            $fontObjects[$id] = ['base' => $base, 'cmap' => $cmap];
        }

        // Resource dictionaries map the /F1 names used in content streams to font
        // objects — but they are often reached indirectly (/Resources 50 0 R),
        // so matching on a literal "/Font <<...>>" misses most real files.
        // Instead: any name => reference pair that points at a known font object
        // is a font resource entry, wherever it lives.
        $resourceToObject = [];
        foreach ($heads as $head) {
            if (!preg_match_all('~/([A-Za-z0-9#+.\-_]{1,40})\s+(\d+)\s+0\s+R~', $head, $pairs, PREG_SET_ORDER)) {
                continue;
            }
            foreach ($pairs as $pair) {
                $target = (int) $pair[2];
                if (isset($fontObjects[$target])) {
                    $resourceToObject[$pair[1]] = $target;
                }
            }
        }

        $parsed = [];
        $cmaps  = [];
        $bases  = [];
        foreach ($resourceToObject as $resource => $objectId) {
            if (!isset($fontObjects[$objectId])) {
                continue;
            }
            $font = $fontObjects[$objectId];
            if ($font['base'] !== '') {
                $bases[$resource] = $font['base'];
            }
            $cmapId = $font['cmap'];
            if ($cmapId <= 0) {
                continue;
            }
            if (!array_key_exists($cmapId, $parsed)) {
                $stream          = self::pdfObjectStream($bytes, $cmapId);
                $parsed[$cmapId] = $stream === null ? [] : self::parseCMap($stream);
            }
            if ($parsed[$cmapId]) {
                $cmaps[$resource] = $parsed[$cmapId];
            }
        }

        // Some producers never expose a resource dictionary we can read. If the
        // file has exactly one CMap, it is safe to use it for everything.
        if (!$cmaps) {
            foreach ($fontObjects as $font) {
                if ($font['cmap'] > 0 && !array_key_exists($font['cmap'], $parsed)) {
                    $stream                 = self::pdfObjectStream($bytes, $font['cmap']);
                    $parsed[$font['cmap']] = $stream === null ? [] : self::parseCMap($stream);
                }
            }
            $usable = array_values(array_filter($parsed));
            if (count($usable) === 1) {
                $cmaps['*'] = $usable[0];
            }
        }

        return [
            'cmaps'     => $cmaps,
            'basefonts' => $bases,
            'names'     => array_values(array_unique($names)),
        ];
    }

    /**
     * Object id => the dictionary text at the head of that object.
     *
     * Offsets rather than one giant regex: PDF bodies carry megabytes of binary
     * stream data and backtracking through it is not worth the wait.
     *
     * @return array<int,string>
     */
    private static function pdfObjectHeads(string $bytes): array
    {
        if (!preg_match_all('~(\d+)\s+0\s+obj\b~', $bytes, $m, PREG_OFFSET_CAPTURE | PREG_SET_ORDER)) {
            return [];
        }
        $heads = [];
        $count = count($m);
        for ($i = 0; $i < $count; $i++) {
            $id    = (int) $m[$i][1][0];
            $from  = (int) $m[$i][0][1];
            $next  = $i + 1 < $count ? (int) $m[$i + 1][0][1] : strlen($bytes);
            $slice = substr($bytes, $from, min(2400, $next - $from));
            $stop  = strpos($slice, 'stream');
            $heads[$id] = $stop === false ? $slice : substr($slice, 0, $stop);
        }
        return $heads;
    }

    private static function pdfObjectStream(string $bytes, int $id): ?string
    {
        if (!preg_match('~(?<![0-9])' . $id . '\s+0\s+obj\b~', $bytes, $m, PREG_OFFSET_CAPTURE)) {
            return null;
        }
        $from = (int) $m[0][1];
        $at   = strpos($bytes, 'stream', $from);
        if ($at === false || $at - $from > 3000) {
            return null;
        }
        $head   = substr($bytes, $from, $at - $from);
        $dataAt = $at + 6;
        if (substr($bytes, $dataAt, 2) === "\r\n") {
            $dataAt += 2;
        } elseif (isset($bytes[$dataAt]) && ($bytes[$dataAt] === "\n" || $bytes[$dataAt] === "\r")) {
            $dataAt += 1;
        }
        $end = strpos($bytes, 'endstream', $dataAt);
        if ($end === false) {
            return null;
        }
        $raw = substr($bytes, $dataAt, $end - $dataAt);
        if (strpos($head, 'FlateDecode') !== false) {
            $plain = @gzuncompress($raw);
            if ($plain === false) {
                $plain = @gzinflate($raw);
            }
            if ($plain === false) {
                $plain = @gzinflate(substr($raw, 2));
            }
            return $plain === false ? null : $plain;
        }
        return $raw;
    }

    /** @return array<string,string> hex code => UTF-8 character */
    private static function parseCMap(string $cmap): array
    {
        $map = [];
        if (preg_match_all('~beginbfchar(.*?)endbfchar~s', $cmap, $blocks)) {
            foreach ($blocks[1] as $block) {
                if (preg_match_all('~<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>~', $block, $pairs, PREG_SET_ORDER)) {
                    foreach ($pairs as $pair) {
                        $map[strtolower($pair[1])] = self::utf16beToUtf8($pair[2]);
                    }
                }
            }
        }
        if (preg_match_all('~beginbfrange(.*?)endbfrange~s', $cmap, $blocks)) {
            foreach ($blocks[1] as $block) {
                if (preg_match_all('~<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>~', $block, $ranges, PREG_SET_ORDER)) {
                    foreach ($ranges as $r) {
                        $from = hexdec($r[1]);
                        $to   = hexdec($r[2]);
                        $dst  = hexdec($r[3]);
                        $pad  = strlen($r[1]);
                        if ($to - $from > 4000) {
                            continue;
                        }
                        for ($c = $from; $c <= $to; $c++) {
                            $key = strtolower(str_pad(dechex($c), $pad, '0', STR_PAD_LEFT));
                            $map[$key] = self::codepointToUtf8($dst + ($c - $from));
                        }
                    }
                }
            }
        }
        return $map;
    }

    private static function utf16beToUtf8(string $hex): string
    {
        $bin = @hex2bin(strlen($hex) % 2 === 0 ? $hex : '0' . $hex);
        if ($bin === false) {
            return '';
        }
        $conv = @mb_convert_encoding($bin, 'UTF-8', 'UTF-16BE');
        return is_string($conv) ? $conv : '';
    }

    private static function codepointToUtf8(int $cp): string
    {
        if ($cp < 0 || $cp > 0x10FFFF) {
            return '';
        }
        $conv = @mb_convert_encoding(pack('N', $cp), 'UTF-8', 'UTF-32BE');
        return is_string($conv) ? $conv : '';
    }

    /**
     * Walk a content stream and pull out text runs with their size and colour.
     *
     * @param  array<string,array<string,string>> $cmaps
     * @return array<int,array{text:string,size:float,font:string,color:?string,newline:bool}>
     */
    private static function pdfRuns(string $stream, array $cmaps): array
    {
        $runs    = [];
        $font    = '';
        $size    = 0.0;
        $scale   = 1.0;
        $color   = null;
        $newline = true;

        // Tokenise just the operators we care about.
        $pattern = '~'
            . '/([A-Za-z0-9#+.\-]{1,40})\s+([\d.]+)\s+Tf'            // 1,2 font + size
            . '|([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm'  // 3..8 matrix
            . '|([-\d.]+)\s+([-\d.]+)\s+(?:Td|TD)'                    // 9,10 move
            . '|(T\*)'                                                // 11 next line
            . '|(\[(?:[^\[\]\\\\]|\\\\.)*\])\s*TJ'                    // 12 array show
            . '|(\((?:[^()\\\\]|\\\\.)*\))\s*(?:Tj|\x27|\x22)'        // 13 string show
            . '|(<[0-9A-Fa-f\s]+>)\s*(?:Tj|TJ)'                       // 14 hex show
            . '|([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg'                  // 15,16,17 rgb fill
            . '|([\d.]+)\s+g\b'                                       // 18 grey fill
            . '~';

        if (!preg_match_all($pattern, $stream, $matches, PREG_SET_ORDER)) {
            return $runs;
        }

        foreach ($matches as $m) {
            if (($m[1] ?? '') !== '') {
                $font = $m[1];
                $size = (float) $m[2];
                continue;
            }
            if (($m[3] ?? '') !== '') {
                $scale   = abs((float) $m[6]) ?: 1.0;
                $newline = true;
                continue;
            }
            if (($m[9] ?? '') !== '') {
                $newline = true;
                continue;
            }
            if (($m[11] ?? '') !== '') {
                $newline = true;
                continue;
            }
            if (($m[15] ?? '') !== '') {
                $color = sprintf('#%02x%02x%02x', (int) round((float) $m[15] * 255), (int) round((float) $m[16] * 255), (int) round((float) $m[17] * 255));
                continue;
            }
            if (($m[18] ?? '') !== '') {
                $v = (int) round((float) $m[18] * 255);
                $color = sprintf('#%02x%02x%02x', $v, $v, $v);
                continue;
            }

            $text = '';
            if (($m[12] ?? '') !== '') {
                $text = self::pdfArrayText($m[12], $font, $cmaps);
            } elseif (($m[13] ?? '') !== '') {
                $text = self::pdfDecodeLiteral(substr($m[13], 1, -1), $font, $cmaps);
            } elseif (($m[14] ?? '') !== '') {
                $text = self::pdfDecodeHex(trim($m[14], '<> '), $font, $cmaps);
            } else {
                continue;
            }

            if ($text === '') {
                continue;
            }
            $runs[] = [
                'text'    => $text,
                'size'    => round($size * $scale, 1),
                'font'    => $font,
                'color'   => $color,
                'newline' => $newline,
            ];
            $newline = false;
        }

        return $runs;
    }

    /** @param array<string,array<string,string>> $cmaps */
    private static function pdfArrayText(string $array, string $font, array $cmaps): string
    {
        $text = '';
        if (preg_match_all('~\((?:[^()\\\\]|\\\\.)*\)|<[0-9A-Fa-f\s]+>|(-?[\d.]+)~', $array, $parts, PREG_SET_ORDER)) {
            foreach ($parts as $part) {
                $tok = $part[0];
                if ($tok === '') {
                    continue;
                }
                if ($tok[0] === '(') {
                    $text .= self::pdfDecodeLiteral(substr($tok, 1, -1), $font, $cmaps);
                } elseif ($tok[0] === '<') {
                    $text .= self::pdfDecodeHex(trim($tok, '<> '), $font, $cmaps);
                } elseif (isset($part[1]) && (float) $part[1] < -120) {
                    $text .= ' '; // a big negative kern is a word space
                }
            }
        }
        return $text;
    }

    /** @param array<string,array<string,string>> $cmaps */
    private static function pdfDecodeLiteral(string $raw, string $font, array $cmaps): string
    {
        $decoded = preg_replace_callback('/\\\\([nrtbf()\\\\]|[0-7]{1,3})/', static function ($m) {
            $map = ['n' => "\n", 'r' => "\r", 't' => "\t", 'b' => "\x08", 'f' => "\x0c", '(' => '(', ')' => ')', '\\' => '\\'];
            return $map[$m[1]] ?? chr((int) octdec($m[1]));
        }, $raw) ?? $raw;

        $map = $cmaps[$font] ?? $cmaps['*'] ?? null;
        if ($map) {
            return self::applyCMap($decoded, $map);
        }
        if (strncmp($decoded, "\xFE\xFF", 2) === 0) {
            $conv = @mb_convert_encoding(substr($decoded, 2), 'UTF-8', 'UTF-16BE');
            return is_string($conv) ? $conv : $decoded;
        }
        $conv = @mb_convert_encoding($decoded, 'UTF-8', 'Windows-1252');
        return is_string($conv) ? $conv : $decoded;
    }

    /** @param array<string,array<string,string>> $cmaps */
    private static function pdfDecodeHex(string $hex, string $font, array $cmaps): string
    {
        $hex = preg_replace('/\s+/', '', $hex) ?? '';
        if ($hex === '') {
            return '';
        }
        if (strlen($hex) % 2 !== 0) {
            $hex .= '0';
        }
        $bin = @hex2bin($hex);
        if ($bin === false) {
            return '';
        }
        $map = $cmaps[$font] ?? $cmaps['*'] ?? null;
        if ($map) {
            return self::applyCMap($bin, $map);
        }
        $conv = @mb_convert_encoding($bin, 'UTF-8', 'UTF-16BE');
        return is_string($conv) ? $conv : $bin;
    }

    /** @param array<string,string> $map */
    private static function applyCMap(string $bin, array $map): string
    {
        // Key width tells us whether codes are one byte or two.
        $width = 2;
        foreach ($map as $key => $_) {
            $width = strlen($key) <= 2 ? 1 : 2;
            break;
        }
        $out = '';
        $len = strlen($bin);
        for ($i = 0; $i < $len; $i += $width) {
            $chunk = substr($bin, $i, $width);
            $key   = strtolower(bin2hex($chunk));
            if (isset($map[$key])) {
                $out .= $map[$key];
            } elseif ($width === 1) {
                $out .= $chunk;
            }
        }
        return $out;
    }

    // =================================================================== DOCX

    private static function readOfficeZip(string $bytes, string $kind): array
    {
        $out = self::blank();
        if (!class_exists('ZipArchive')) {
            $out['error'] = 'This server has no ZipArchive extension, so .docx files cannot be opened. Save the document as PDF and try again.';
            return $out;
        }

        $tmp = tempnam(sys_get_temp_dir(), 'dkdoc');
        if ($tmp === false || file_put_contents($tmp, $bytes) === false) {
            $out['error'] = 'Could not stage the file for reading.';
            return $out;
        }

        $zip = new \ZipArchive();
        if ($zip->open($tmp) !== true) {
            @unlink($tmp);
            $out['error'] = 'The file is not a readable Office document.';
            return $out;
        }

        $xml = '';
        if ($kind === 'docx') {
            $xml = (string) $zip->getFromName('word/document.xml');
        } else {
            for ($i = 1; $i <= 60; $i++) {
                $slide = $zip->getFromName('ppt/slides/slide' . $i . '.xml');
                if ($slide === false) {
                    break;
                }
                $xml .= $slide;
            }
        }
        $styles = (string) $zip->getFromName($kind === 'docx' ? 'word/styles.xml' : 'ppt/theme/theme1.xml');
        $core   = (string) $zip->getFromName('docProps/core.xml');
        $app    = (string) $zip->getFromName('docProps/app.xml');
        $zip->close();
        @unlink($tmp);

        if ($xml === '') {
            $out['error'] = 'The document body could not be read.';
            return $out;
        }

        $out['ok'] = true;
        if (preg_match('~<dc:title>([^<]*)</dc:title>~', $core, $m)) {
            $out['title'] = trim($m[1]);
        }
        if (preg_match('~<cp:lastModifiedBy>([^<]*)~', $core, $m)) {
            $out['creator'] = trim($m[1]);
        }
        if (preg_match('~<Application>([^<]*)~', $app, $m)) {
            $out['producer'] = trim($m[1]);
        }
        if (preg_match('~<dcterms:modified[^>]*>(\d{4}-\d{2}-\d{2})~', $core, $m)) {
            $out['modified'] = $m[1];
        }
        if (preg_match('~<dcterms:created[^>]*>(\d{4}-\d{2}-\d{2})~', $core, $m)) {
            $out['created'] = $m[1];
        }
        if (preg_match('~<Pages>(\d+)~', $app, $m)) {
            $out['pages'] = (int) $m[1];
        }
        if (preg_match('~w:lang[^>]*w:val="([a-zA-Z-]+)"~', $xml, $m)) {
            $out['lang'] = $m[1];
        }

        // Paragraphs, headings and lists straight from the markup.
        $runs = [];
        if (preg_match_all('~<w:p\b[^>]*>(.*?)</w:p>~s', $xml, $paras)) {
            foreach ($paras[1] as $para) {
                $text = trim(html_entity_decode(strip_tags(preg_replace('~<w:tab[^>]*/>~', ' ', $para) ?? $para), ENT_QUOTES | ENT_XML1, 'UTF-8'));
                $text = trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
                if ($text === '') {
                    continue;
                }
                $level = 0;
                if (preg_match('~w:pStyle[^>]*w:val="(?:Heading|heading)\s*(\d)~', $para, $m)) {
                    $level = (int) $m[1];
                } elseif (preg_match('~w:pStyle[^>]*w:val="(Title|Subtitle)"~', $para)) {
                    $level = 1;
                }
                $isList = strpos($para, '<w:numPr') !== false;
                $size   = 0.0;
                if (preg_match('~<w:sz w:val="(\d+)"~', $para, $m)) {
                    $size = (int) $m[1] / 2; // half-points
                }
                if (preg_match('~w:ascii="([^"]+)"~', $para, $m)) {
                    $out['fonts'][] = $m[1];
                }
                if (preg_match('~<w:color w:val="([0-9A-Fa-f]{6})"~', $para, $m)) {
                    $out['colors']['#' . strtolower($m[1])] = ($out['colors']['#' . strtolower($m[1])] ?? 0) + 1;
                }
                $runs[] = ['text' => $text, 'size' => $size, 'font' => '', 'color' => null, 'newline' => true, 'level' => $level, 'list' => $isList];
            }
        }
        if (preg_match_all('~w:ascii="([^"]+)"~', $styles, $m)) {
            foreach ($m[1] as $f) {
                $out['fonts'][] = $f;
            }
        }
        if (!$runs) {
            $out['error'] = 'No paragraphs found in the document body.';
            return $out;
        }
        return self::fromRuns($out, $runs);
    }

    // =================================================================== HTML

    private static function readHtml(string $bytes): array
    {
        $out = self::blank();
        $h   = new Html('https://document.local/', $bytes);
        if (!$h->ok()) {
            $out['error'] = 'The HTML could not be parsed.';
            return $out;
        }
        $out['ok']    = true;
        $out['title'] = $h->title();
        $html         = $h->first('//html');
        $out['lang']  = $html ? trim($html->getAttribute('lang')) : '';

        $runs = [];
        foreach ($h->query('//h1|//h2|//h3|//h4|//p|//li|//td|//blockquote') as $el) {
            $text = Html::text($el);
            if ($text === '') {
                continue;
            }
            $tag   = strtolower($el->nodeName);
            $level = in_array($tag, ['h1', 'h2', 'h3', 'h4'], true) ? (int) substr($tag, 1) : 0;
            $runs[] = ['text' => $text, 'size' => 0.0, 'font' => '', 'color' => null, 'newline' => true, 'level' => $level, 'list' => $tag === 'li'];
        }
        $css = $h->inlineCss();
        if (preg_match_all('/font-family\s*:\s*([^;{}]+)/i', $css, $m)) {
            foreach ($m[1] as $stack) {
                $out['fonts'][] = trim(trim(explode(',', $stack)[0]), "\"' ");
            }
        }
        if (preg_match_all('/#([0-9a-f]{6})\b/i', $css, $m)) {
            foreach ($m[1] as $hex) {
                $key = '#' . strtolower($hex);
                $out['colors'][$key] = ($out['colors'][$key] ?? 0) + 1;
            }
        }
        if (!$runs) {
            $out['error'] = 'The page has no readable body text.';
            return $out;
        }
        return self::fromRuns($out, $runs);
    }

    // ============================================================ plain text

    private static function readPlain(string $bytes, string $ext): array
    {
        $out = self::blank();
        $text = @mb_convert_encoding($bytes, 'UTF-8', 'UTF-8, Windows-1252, ISO-8859-1');
        if (!is_string($text) || trim($text) === '') {
            $out['error'] = 'The file has no readable text.';
            return $out;
        }
        $out['ok'] = true;

        $runs = [];
        foreach (preg_split('/\R{1,}/u', $text) ?: [] as $line) {
            $line = rtrim($line);
            if (trim($line) === '') {
                continue;
            }
            $level = 0;
            $list  = false;
            if ($ext === 'md' || $ext === 'markdown') {
                if (preg_match('/^(#{1,4})\s+(.*)$/', $line, $m)) {
                    $level = strlen($m[1]);
                    $line  = $m[2];
                } elseif (preg_match('/^\s*([-*+]|\d+\.)\s+(.*)$/', $line, $m)) {
                    $list = true;
                    $line = $m[2];
                }
            } elseif (preg_match('/^\s*([-*•]|\d+[.)])\s+(.*)$/u', $line, $m)) {
                $list = true;
                $line = $m[2];
            }
            $runs[] = ['text' => trim($line), 'size' => 0.0, 'font' => '', 'color' => null, 'newline' => true, 'level' => $level, 'list' => $list];
        }
        return self::fromRuns($out, $runs);
    }

    // ================================================================= shared

    /**
     * Turn runs into lines, then into text, headings, paragraphs and type facts.
     *
     * @param array<int,array<string,mixed>> $runs
     */
    private static function fromRuns(array $out, array $runs, bool $skipRunFonts = false): array
    {
        $lines = [];
        $current = null;

        foreach ($runs as $run) {
            $text = (string) $run['text'];
            if (trim($text) === '') {
                continue;
            }
            $size = (float) ($run['size'] ?? 0);
            if ($size > 0) {
                $key = (string) round($size, 1);
                $out['sizes'][$key] = ($out['sizes'][$key] ?? 0) + max(1, mb_strlen($text));
            }
            if (!$skipRunFonts && !empty($run['font'])) {
                $out['fonts'][] = self::cleanFontName((string) $run['font']);
            }
            if (!empty($run['color'])) {
                $out['colors'][$run['color']] = ($out['colors'][$run['color']] ?? 0) + max(1, mb_strlen($text));
            }

            if (!empty($run['newline']) || $current === null) {
                if ($current !== null) {
                    $lines[] = $current;
                }
                $current = [
                    'text'  => $text,
                    'size'  => $size,
                    'level' => (int) ($run['level'] ?? 0),
                    'list'  => (bool) ($run['list'] ?? false),
                ];
            } else {
                $current['text'] .= $text;
                $current['size']  = max($current['size'], $size);
            }
        }
        if ($current !== null) {
            $lines[] = $current;
        }

        // Body size = the size most of the characters are set in.
        $bodySize = 0.0;
        if ($out['sizes']) {
            arsort($out['sizes']);
            $bodySize = (float) array_key_first($out['sizes']);
        }

        $textParts  = [];
        $headings   = [];
        $paragraphs = [];
        $listItems  = 0;

        foreach ($lines as $line) {
            $clean = trim(preg_replace('/\s+/u', ' ', $line['text']) ?? $line['text']);
            if ($clean === '') {
                continue;
            }
            $textParts[] = $clean;

            $words = str_word_count($clean, 0, '0123456789₹$%.-');
            $isHeadingByMarkup = $line['level'] > 0;
            $isHeadingBySize   = $bodySize > 0 && $line['size'] >= $bodySize * 1.18 && $words <= 14;
            $isHeadingByCase   = $words <= 10 && $words >= 1
                && preg_match('/^[A-Z0-9]/', $clean)
                && !preg_match('/[.!?]$/', $clean)
                && mb_strtoupper($clean) === $clean
                && mb_strlen($clean) > 3;

            if ($line['list']) {
                $listItems++;
                continue;
            }
            if ($isHeadingByMarkup || $isHeadingBySize || $isHeadingByCase) {
                $headings[] = [
                    'level' => $line['level'] ?: ($isHeadingBySize ? 2 : 3),
                    'text'  => $clean,
                    'size'  => $line['size'],
                ];
                continue;
            }
            if (preg_match('/^\s*[-•*‣▪]\s?/u', $clean)) {
                $listItems++;
                continue;
            }
            $paragraphs[] = $clean;
        }

        $out['lines']      = count($lines);
        $out['text']       = implode("\n", $textParts);
        $out['headings']   = $headings;
        $out['paragraphs'] = $paragraphs;
        $out['list_items'] = $listItems;
        $out['body_size']  = $bodySize;
        return $out;
    }

    private static function cleanFontName(string $name): string
    {
        // PDF subset prefixes look like ABCDEF+Helvetica-Bold
        $name = preg_replace('/^[A-Z]{6}\+/', '', $name) ?? $name;
        $name = preg_replace('/[,-](Bold|Italic|Oblique|Regular|Light|Medium|Semibold|Black|BoldItalic|MT|PS)$/i', '', $name) ?? $name;
        $name = str_replace('#20', ' ', $name);
        return trim($name);
    }

    private static function finish(array $out): array
    {
        $out['fonts'] = array_values(array_unique(array_filter(array_map('trim', $out['fonts']))));
        // Font resource names like F1/F2 tell us nothing about the typeface.
        $out['fonts'] = array_values(array_filter($out['fonts'], static fn($f) => !preg_match('/^(F|TT|C|G|T)\d{1,3}$/i', $f) && mb_strlen($f) > 2));
        arsort($out['colors']);
        arsort($out['sizes']);

        $text = (string) $out['text'];
        $out['words'] = $text === '' ? 0 : count(preg_split('/\s+/u', trim($text)) ?: []);
        return $out;
    }

    /** @return array<string,mixed> */
    private static function blank(): array
    {
        return [
            'ok'         => false,
            'error'      => '',
            'kind'       => '',
            'bytes'      => 0,
            'text'       => '',
            'words'      => 0,
            'lines'      => 0,
            'pages'      => null,
            'headings'   => [],
            'paragraphs' => [],
            'list_items' => 0,
            'fonts'      => [],
            'sizes'      => [],
            'colors'     => [],
            'body_size'  => 0.0,
            'lang'       => '',
            'tagged'     => false,
            'title'      => '',
            'producer'   => '',
            'creator'    => '',
            'created'    => null,
            'modified'   => null,
            'cmapped'    => false,
        ];
    }
}
