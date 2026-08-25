<?php

declare(strict_types=1);

namespace DK\Support;

/**
 * URL validation + SSRF guard.
 *
 * check() normalises a user-supplied URL, resolves the host once, and rejects
 * anything that points at a private, loopback, link-local or reserved address.
 * The resolved IP comes back so the caller can pin the connection to it.
 */
final class UrlGuard
{
    /**
     * @return array{ok:bool,error:string,normalised:string,host:string,port:int,ip:string,scheme:string}
     */
    public static function check(string $url, bool $allowPrivate = false): array
    {
        $fail = static function (string $msg): array {
            return ['ok' => false, 'error' => $msg, 'normalised' => '', 'host' => '', 'port' => 0, 'ip' => '', 'scheme' => ''];
        };

        $url = trim($url);
        if ($url === '') {
            return $fail('Empty URL');
        }
        if (!preg_match('~^[a-z][a-z0-9+.\-]*://~i', $url)) {
            $url = 'https://' . ltrim($url, '/');
        }

        $parts = parse_url($url);
        if ($parts === false || empty($parts['host'])) {
            return $fail('Could not read that URL');
        }

        $scheme = strtolower($parts['scheme'] ?? 'https');
        if ($scheme !== 'http' && $scheme !== 'https') {
            return $fail('Only http and https URLs are supported');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            return $fail('URLs with embedded credentials are not allowed');
        }

        $host = strtolower($parts['host']);
        $host = rtrim($host, '.');
        if (function_exists('idn_to_ascii')) {
            $ascii = @idn_to_ascii($host, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
            if (is_string($ascii) && $ascii !== '') {
                $host = $ascii;
            }
        }
        if ($host === '' || strlen($host) > 253) {
            return $fail('Invalid hostname');
        }

        $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
        if (!in_array($port, [80, 443, 8080, 8443], true)) {
            return $fail('Port ' . $port . ' is not allowed');
        }

        $ip = self::resolve($host);
        if ($ip === null) {
            return $fail('DNS lookup failed for ' . $host);
        }
        if (!$allowPrivate && !self::isPublicIp($ip)) {
            return $fail('That hostname resolves to a private address');
        }

        $path  = $parts['path'] ?? '/';
        $path  = $path === '' ? '/' : $path;
        $query = isset($parts['query']) ? '?' . $parts['query'] : '';
        $norm  = $scheme . '://' . $host . (in_array($port, [80, 443], true) ? '' : ':' . $port) . $path . $query;

        return ['ok' => true, 'error' => '', 'normalised' => $norm, 'host' => $host, 'port' => $port, 'ip' => $ip, 'scheme' => $scheme];
    }

    /** Resolve to a single IP, preferring IPv4 (shared hosts are often v4-only outbound). */
    private static function resolve(string $host): ?string
    {
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return $host;
        }
        $v4 = @gethostbynamel($host);
        if (is_array($v4) && $v4) {
            return $v4[0];
        }
        $records = @dns_get_record($host, DNS_AAAA);
        if (is_array($records)) {
            foreach ($records as $r) {
                if (!empty($r['ipv6'])) {
                    return $r['ipv6'];
                }
            }
        }
        return null;
    }

    public static function isPublicIp(string $ip): bool
    {
        return (bool) filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        );
    }

    /** Resolve a possibly-relative URL against a base. Returns null when unusable. */
    public static function resolveRelative(string $base, string $rel): ?string
    {
        $rel = trim($rel);
        if ($rel === '' || strpos($rel, '#') === 0) {
            return null;
        }
        if (preg_match('~^(javascript|mailto|tel|data|whatsapp|sms|intent):~i', $rel)) {
            return null;
        }
        if (preg_match('~^https?://~i', $rel)) {
            return $rel;
        }
        if (strpos($rel, '//') === 0) {
            $scheme = parse_url($base, PHP_URL_SCHEME) ?: 'https';
            return $scheme . ':' . $rel;
        }

        $b = parse_url($base);
        if (!$b || empty($b['host'])) {
            return null;
        }
        $origin = ($b['scheme'] ?? 'https') . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');

        if (strpos($rel, '/') === 0) {
            return $origin . self::tidyPath($rel);
        }

        $dir = rtrim(dirname(($b['path'] ?? '/') === '' ? '/' : $b['path']), '/');
        return $origin . self::tidyPath($dir . '/' . $rel);
    }

    /** Collapse ./ and ../ segments. */
    private static function tidyPath(string $path): string
    {
        $query = '';
        if (($pos = strpos($path, '?')) !== false) {
            $query = substr($path, $pos);
            $path  = substr($path, 0, $pos);
        }
        $out = [];
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }
            if ($segment === '..') {
                array_pop($out);
                continue;
            }
            $out[] = $segment;
        }
        $trailing = substr($path, -1) === '/' ? '/' : '';
        return '/' . implode('/', $out) . ($out ? $trailing : '') . $query;
    }

    /** registrable-ish host without www, for same-site comparisons */
    public static function baseHost(string $url): string
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        return preg_replace('/^www\./', '', $host) ?? $host;
    }

    public static function sameSite(string $a, string $b): bool
    {
        $ha = self::baseHost($a);
        $hb = self::baseHost($b);
        if ($ha === '' || $hb === '') {
            return false;
        }
        if ($ha === $hb) {
            return true;
        }
        // treat sub.example.com and example.com as one site
        return str_ends_with($ha, '.' . $hb) || str_ends_with($hb, '.' . $ha);
    }
}
