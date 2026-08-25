<?php

declare(strict_types=1);

namespace DK\Support;

/**
 * Minimal PDF metadata reader.
 *
 * Reads only the first slice of a file (range request) and pulls what is there:
 * the Info dictionary when the PDF is linearised, otherwise the XMP packet.
 * Anything it cannot read stays null rather than being guessed.
 */
final class Pdf
{
    /**
     * @return array{is_pdf:bool,title:?string,producer:?string,creator:?string,created:?string,modified:?string,pages:?int}
     */
    public static function meta(string $head): array
    {
        $out = [
            'is_pdf'   => strncmp($head, '%PDF-', 5) === 0,
            'title'    => null,
            'producer' => null,
            'creator'  => null,
            'created'  => null,
            'modified' => null,
            'pages'    => null,
        ];
        if ($head === '') {
            return $out;
        }

        // ---- Info dictionary (classic)
        foreach ([
            'title'    => '/Title',
            'producer' => '/Producer',
            'creator'  => '/Creator',
        ] as $key => $marker) {
            $val = self::infoString($head, $marker);
            if ($val !== null && $val !== '') {
                $out[$key] = $val;
            }
        }
        foreach (['created' => '/CreationDate', 'modified' => '/ModDate'] as $key => $marker) {
            $raw = self::infoString($head, $marker);
            if ($raw !== null) {
                $iso = self::pdfDate($raw);
                if ($iso !== null) {
                    $out[$key] = $iso;
                }
            }
        }

        // ---- XMP packet (modern exporters)
        if ($out['created'] === null && preg_match('~<xmp:CreateDate>([^<]+)<~i', $head, $m)) {
            $out['created'] = self::isoDate($m[1]);
        }
        if ($out['created'] === null && preg_match('~xmp:CreateDate="([^"]+)"~i', $head, $m)) {
            $out['created'] = self::isoDate($m[1]);
        }
        if ($out['modified'] === null && preg_match('~<xmp:ModifyDate>([^<]+)<~i', $head, $m)) {
            $out['modified'] = self::isoDate($m[1]);
        }
        if ($out['modified'] === null && preg_match('~xmp:ModifyDate="([^"]+)"~i', $head, $m)) {
            $out['modified'] = self::isoDate($m[1]);
        }
        if ($out['title'] === null && preg_match('~<dc:title>.*?<rdf:li[^>]*>([^<]{1,200})</rdf:li>~is', $head, $m)) {
            $out['title'] = trim($m[1]);
        }
        if ($out['producer'] === null && preg_match('~<pdf:Producer>([^<]{1,120})<~i', $head, $m)) {
            $out['producer'] = trim($m[1]);
        }
        if ($out['creator'] === null && preg_match('~<xmp:CreatorTool>([^<]{1,120})<~i', $head, $m)) {
            $out['creator'] = trim($m[1]);
        }

        if (preg_match('~/Type\s*/Pages\b[^>]*?/Count\s+(\d{1,5})~s', $head, $m)) {
            $out['pages'] = (int) $m[1];
        }

        foreach (['title', 'producer', 'creator'] as $k) {
            if (is_string($out[$k])) {
                $out[$k] = self::clean($out[$k]);
                if ($out[$k] === '') {
                    $out[$k] = null;
                }
            }
        }

        return $out;
    }

    /** Pull `/Key (value)` or `/Key <hex>` out of the raw bytes. */
    private static function infoString(string $head, string $marker): ?string
    {
        $q = preg_quote($marker, '~');
        if (preg_match('~' . $q . '\s*\(((?:\\\\.|[^()\\\\])*)\)~s', $head, $m)) {
            return self::unescape($m[1]);
        }
        if (preg_match('~' . $q . '\s*<([0-9A-Fa-f\s]+)>~s', $head, $m)) {
            $hex = preg_replace('/\s+/', '', $m[1]) ?? '';
            $bin = @hex2bin(strlen($hex) % 2 === 0 ? $hex : substr($hex, 0, -1));
            return $bin === false ? null : self::decodeText($bin);
        }
        return null;
    }

    private static function unescape(string $s): string
    {
        $s = preg_replace_callback('/\\\\([nrtbf()\\\\]|[0-7]{1,3})/', static function ($m) {
            $map = ['n' => "\n", 'r' => "\r", 't' => "\t", 'b' => "\x08", 'f' => "\x0c", '(' => '(', ')' => ')', '\\' => '\\'];
            if (isset($map[$m[1]])) {
                return $map[$m[1]];
            }
            return chr((int) octdec($m[1]));
        }, $s) ?? $s;
        return self::decodeText($s);
    }

    private static function decodeText(string $s): string
    {
        // UTF-16BE with BOM is the common case for non-ASCII PDF strings.
        if (strncmp($s, "\xFE\xFF", 2) === 0) {
            $conv = @mb_convert_encoding(substr($s, 2), 'UTF-8', 'UTF-16BE');
            return is_string($conv) ? $conv : $s;
        }
        return $s;
    }

    private static function clean(string $s): string
    {
        $s = preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/u', '', $s) ?? $s;
        $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
        return trim($s);
    }

    /** D:20190412153012+05'30' → 2019-04-12 */
    private static function pdfDate(string $raw): ?string
    {
        if (preg_match('/(\d{4})(\d{2})(\d{2})/', $raw, $m)) {
            $y = (int) $m[1];
            if ($y >= 1990 && $y <= (int) gmdate('Y') + 1) {
                return sprintf('%04d-%02d-%02d', $y, max(1, (int) $m[2]), max(1, (int) $m[3]));
            }
        }
        return null;
    }

    private static function isoDate(string $raw): ?string
    {
        if (preg_match('/(\d{4})-(\d{2})-(\d{2})/', $raw, $m)) {
            return $m[1] . '-' . $m[2] . '-' . $m[3];
        }
        return null;
    }

    /** Does this producer string look like a default Office/slide export? */
    public static function isOfficeExport(?string ...$fields): bool
    {
        $hay = mb_strtolower(implode(' ', array_filter($fields)));
        if ($hay === '') {
            return false;
        }
        foreach (['microsoft® word', 'microsoft word', 'microsoft® powerpoint', 'microsoft powerpoint',
                  'microsoft® excel', 'microsoft excel', 'wps ', 'libreoffice', 'openoffice',
                  'google docs', 'google slides', 'skia/pdf'] as $needle) {
            if (strpos($hay, $needle) !== false) {
                return true;
            }
        }
        return false;
    }
}
