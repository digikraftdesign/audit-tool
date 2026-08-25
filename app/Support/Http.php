<?php

declare(strict_types=1);

namespace DK\Support;

/**
 * Guarded HTTP client.
 *
 * Everything this tool fetches is a URL a user typed, so the client does the
 * boring safety work: scheme allow-list, DNS resolution pinned to a validated
 * public IP (kills DNS-rebinding), manual redirect following with re-validation
 * at every hop, hard byte cap, and hard timeouts.
 */
final class Http
{
    /** @var array<string,mixed> */
    private array $cfg;

    /** @var array<string,array{allowed:bool,rules:array<int,string>}> */
    private array $robots = [];

    /** @param array<string,mixed> $cfg */
    public function __construct(array $cfg = [])
    {
        $this->cfg = $cfg + [
            'timeout'             => 12,
            'connect_timeout'     => 6,
            'max_bytes'           => 2500000,
            'max_redirects'       => 4,
            'user_agent'          => 'DigiKraftAuditBot/1.0',
            'allow_private_hosts' => false,
            'obey_robots'         => true,
        ];
    }

    /**
     * Fetch one URL.
     *
     * @return array{ok:bool,url:string,final_url:string,status:int,body:string,headers:array<string,string>,
     *                content_type:string,bytes:int,ttfb:float,total:float,error:string,redirects:array<int,string>,truncated:bool}
     */
    public function get(string $url, bool $headOnly = false): array
    {
        $result = $this->blank($url);
        $chain  = [];
        $target = $url;

        for ($hop = 0; $hop <= (int) $this->cfg['max_redirects']; $hop++) {
            $check = UrlGuard::check($target, (bool) $this->cfg['allow_private_hosts']);
            if (!$check['ok']) {
                $result['error'] = $check['error'];
                return $result;
            }
            if ($this->cfg['obey_robots'] && !$headOnly && !$this->robotsAllows($check['normalised'], $check['ip'])) {
                $result['error']  = 'Blocked by robots.txt';
                $result['status'] = 999;
                return $result;
            }

            $one = $this->raw($check['normalised'], $check['host'], $check['port'], $check['ip'], $headOnly);
            $one['redirects'] = $chain;
            $one['url']       = $url;

            $location = $one['headers']['location'] ?? '';
            if ($one['status'] >= 300 && $one['status'] < 400 && $location !== '') {
                $next = UrlGuard::resolveRelative($check['normalised'], $location);
                if ($next === null) {
                    $one['error'] = 'Unresolvable redirect: ' . $location;
                    return $one;
                }
                $chain[]  = $next;
                $target   = $next;
                continue;
            }

            return $one;
        }

        $result['error'] = 'Too many redirects';
        $result['redirects'] = $chain;
        return $result;
    }

    /**
     * Fetch several URLs in parallel. Each URL is validated exactly like get().
     *
     * @param  array<int,string> $urls
     * @param  float             $deadline Unix timestamp; fetching stops when passed.
     * @return array<string,array<string,mixed>> keyed by the requested URL
     */
    public function getMany(array $urls, float $deadline = 0.0): array
    {
        $urls = array_values(array_unique(array_filter($urls)));
        $out  = [];
        if (!$urls) {
            return $out;
        }

        $multi   = curl_multi_init();
        $handles = [];
        $buffers = [];
        $headers = [];

        foreach ($urls as $i => $url) {
            $check = UrlGuard::check($url, (bool) $this->cfg['allow_private_hosts']);
            if (!$check['ok']) {
                $out[$url] = ['error' => $check['error']] + $this->blank($url);
                continue;
            }
            if ($this->cfg['obey_robots'] && !$this->robotsAllows($check['normalised'], $check['ip'])) {
                $out[$url] = ['error' => 'Blocked by robots.txt', 'status' => 999] + $this->blank($url);
                continue;
            }
            $buffers[$i] = '';
            $headers[$i] = [];
            $ch = $this->handle($check['normalised'], $check['host'], $check['port'], $check['ip'], false, $buffers[$i]);
            // Deliberately NOT following redirects here: curl would resolve the
            // next hop itself and skip the guard. 3xx responses are re-fetched
            // below through get(), which validates every hop.
            curl_setopt($ch, CURLOPT_HEADERFUNCTION, static function ($c, $line) use (&$headers, $i) {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $headers[$i][strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return strlen($line);
            });
            $handles[$i] = ['ch' => $ch, 'url' => $url];
            curl_multi_add_handle($multi, $ch);
        }

        $running = null;
        do {
            curl_multi_exec($multi, $running);
            if ($running > 0) {
                curl_multi_select($multi, 0.4);
            }
            if ($deadline > 0 && microtime(true) > $deadline) {
                break;
            }
        } while ($running > 0);

        foreach ($handles as $i => $h) {
            $ch  = $h['ch'];
            $url = $h['url'];
            $row = $this->blank($url);
            $err = curl_error($ch);
            $row['status']       = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $row['final_url']    = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
            $row['content_type'] = strtolower(explode(';', (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE))[0]);
            $row['ttfb']         = round((float) curl_getinfo($ch, CURLINFO_STARTTRANSFER_TIME), 3);
            $row['total']        = round((float) curl_getinfo($ch, CURLINFO_TOTAL_TIME), 3);
            $row['body']         = $buffers[$i] ?? '';
            $row['headers']      = $headers[$i] ?? [];
            $row['bytes']        = strlen($row['body']);
            $row['truncated']    = $row['bytes'] >= (int) $this->cfg['max_bytes'];
            $row['ok']           = $row['status'] >= 200 && $row['status'] < 300 && $row['body'] !== '';
            $row['error']        = $row['ok'] ? '' : ($err !== '' ? $err : ($row['status'] ? 'HTTP ' . $row['status'] : 'No response'));
            $out[$url]           = $row;
            curl_multi_remove_handle($multi, $ch);
        }
        curl_multi_close($multi);

        // Second pass: anything that answered with a redirect is fetched again
        // through the guarded path, which checks the destination properly.
        $redirects = 0;
        foreach ($out as $url => $row) {
            if ($redirects >= 4) {
                break;
            }
            if ($row['status'] < 300 || $row['status'] >= 400 || empty($row['headers']['location'])) {
                continue;
            }
            if ($deadline > 0 && microtime(true) > $deadline) {
                break;
            }
            $redirects++;
            $followed = $this->get($url);
            $followed['url'] = $url;
            $out[$url] = $followed;
        }

        return $out;
    }

    /** Range request: reads only the first N bytes of a file (used for PDF metadata). */
    public function getRange(string $url, int $bytes = 262144, int $depth = 0): array
    {
        $check = UrlGuard::check($url, (bool) $this->cfg['allow_private_hosts']);
        if (!$check['ok']) {
            return ['error' => $check['error']] + $this->blank($url);
        }
        $buffer  = '';
        $headers = [];
        $ch = $this->handle($check['normalised'], $check['host'], $check['port'], $check['ip'], false, $buffer, $bytes);
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, static function ($c, $line) use (&$headers) {
            $parts = explode(':', $line, 2);
            if (count($parts) === 2) {
                $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return strlen($line);
        });
        curl_setopt($ch, CURLOPT_RANGE, '0-' . ($bytes - 1));
        curl_exec($ch);
        $row = $this->blank($url);
        $row['status']       = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $row['final_url']    = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $row['content_type'] = strtolower(explode(';', (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE))[0]);
        $row['bytes']        = (int) curl_getinfo($ch, CURLINFO_SIZE_DOWNLOAD);
        $row['headers']      = $headers;
        $row['total_bytes']  = self::fullSize($headers, (float) curl_getinfo($ch, CURLINFO_CONTENT_LENGTH_DOWNLOAD));
        $row['body']         = $buffer;
        $row['error']        = curl_error($ch);
        $row['ok']           = $row['status'] >= 200 && $row['status'] < 400 && $buffer !== '';

        // Follow one redirect, re-validating the destination first.
        if ($row['status'] >= 300 && $row['status'] < 400 && !empty($headers['location']) && $depth < 3) {
            $next = UrlGuard::resolveRelative($check['normalised'], (string) $headers['location']);
            if ($next !== null) {
                return $this->getRange($next, $bytes, $depth + 1);
            }
        }

        return $row;
    }

    /** Full resource size from Content-Range, falling back to Content-Length. */
    private static function fullSize(array $headers, float $downloaded): int
    {
        if (!empty($headers['content-range']) && preg_match('~/(\d+)\s*$~', $headers['content-range'], $m)) {
            return (int) $m[1];
        }
        if (!empty($headers['content-length'])) {
            return (int) $headers['content-length'];
        }
        return $downloaded > 0 ? (int) $downloaded : 0;
    }

    // ------------------------------------------------------------------ internals

    private function raw(string $url, string $host, int $port, string $ip, bool $headOnly): array
    {
        $buffer  = '';
        $headers = [];
        $ch      = $this->handle($url, $host, $port, $ip, $headOnly, $buffer);
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, static function ($c, $line) use (&$headers) {
            $parts = explode(':', $line, 2);
            if (count($parts) === 2) {
                $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return strlen($line);
        });

        curl_exec($ch);

        $row = $this->blank($url);
        $row['final_url']    = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $row['status']       = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $row['content_type'] = strtolower(explode(';', (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE))[0]);
        $row['ttfb']         = round((float) curl_getinfo($ch, CURLINFO_STARTTRANSFER_TIME), 3);
        $row['total']        = round((float) curl_getinfo($ch, CURLINFO_TOTAL_TIME), 3);
        $row['headers']      = $headers;
        $row['body']         = $buffer;
        $row['bytes']        = $headOnly ? (int) curl_getinfo($ch, CURLINFO_SIZE_DOWNLOAD) : strlen($buffer);
        $row['truncated']    = strlen($buffer) >= (int) $this->cfg['max_bytes'];
        $err                 = curl_error($ch);
        $row['ok']           = $row['status'] >= 200 && $row['status'] < 300;
        $row['error']        = $row['ok'] ? '' : ($err !== '' ? $err : ($row['status'] ? 'HTTP ' . $row['status'] : 'No response'));

        return $row;
    }

    /**
     * @param  string $buffer passed by reference so the write callback can fill it
     * @return \CurlHandle
     */
    private function handle(string $url, string $host, int $port, string $ip, bool $headOnly, string &$buffer, ?int $cap = null)
    {
        $cap = $cap ?? (int) $this->cfg['max_bytes'];
        $ch  = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL             => $url,
            CURLOPT_RETURNTRANSFER  => false,
            CURLOPT_FOLLOWLOCATION  => false,
            CURLOPT_NOBODY          => $headOnly,
            CURLOPT_TIMEOUT         => (int) $this->cfg['timeout'],
            CURLOPT_CONNECTTIMEOUT  => (int) $this->cfg['connect_timeout'],
            CURLOPT_USERAGENT       => (string) $this->cfg['user_agent'],
            CURLOPT_ENCODING        => '',
            CURLOPT_SSL_VERIFYPEER  => true,
            CURLOPT_SSL_VERIFYHOST  => 2,
            CURLOPT_PROTOCOLS_STR   => 'http,https',
            CURLOPT_HTTPHEADER      => [
                'Accept: text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
                'Accept-Language: en-IN,en;q=0.9',
            ],
        ]);
        // Pin the hostname to the IP we validated, so a second DNS lookup cannot
        // swing the request onto a private address. SNI and Host stay correct.
        if ($ip !== '') {
            curl_setopt($ch, CURLOPT_RESOLVE, [$host . ':' . $port . ':' . $ip]);
        }
        if (!$headOnly) {
            curl_setopt($ch, CURLOPT_WRITEFUNCTION, static function ($c, $chunk) use (&$buffer, $cap) {
                $len = strlen($chunk);
                if (strlen($buffer) < $cap) {
                    $buffer .= substr($chunk, 0, $cap - strlen($buffer));
                    return $len;
                }
                return 0; // abort: cap reached
            });
        }
        return $ch;
    }

    private function robotsAllows(string $url, string $ip): bool
    {
        $parts = parse_url($url);
        if (!$parts || empty($parts['host'])) {
            return true;
        }
        $origin = ($parts['scheme'] ?? 'https') . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $path   = ($parts['path'] ?? '/') ?: '/';

        if (!isset($this->robots[$origin])) {
            $this->robots[$origin] = ['allowed' => true, 'rules' => []];
            $buffer = '';
            $ch = $this->handle($origin . '/robots.txt', (string) $parts['host'], (int) ($parts['port'] ?? (($parts['scheme'] ?? 'https') === 'https' ? 443 : 80)), $ip, false, $buffer, 120000);
            curl_setopt($ch, CURLOPT_TIMEOUT, 6);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_MAXREDIRS, 2);
            curl_setopt($ch, CURLOPT_REDIR_PROTOCOLS_STR, 'http,https');
            curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            if ($status === 200 && $buffer !== '') {
                $this->robots[$origin]['rules'] = $this->parseRobots($buffer, (string) $this->cfg['user_agent']);
            }
        }

        foreach ($this->robots[$origin]['rules'] as $rule) {
            if ($rule !== '' && strpos($path, $rule) === 0) {
                return false;
            }
        }
        return true;
    }

    /** @return array<int,string> disallowed path prefixes that apply to us */
    private function parseRobots(string $text, string $ua): array
    {
        $lines    = preg_split('/\r\n|\r|\n/', $text) ?: [];
        $groups   = [];
        $current  = [];
        $agents   = [];
        $inGroup  = false;

        foreach ($lines as $line) {
            $line = trim(preg_replace('/#.*$/', '', $line) ?? '');
            if ($line === '') {
                continue;
            }
            $bits = explode(':', $line, 2);
            if (count($bits) !== 2) {
                continue;
            }
            $key = strtolower(trim($bits[0]));
            $val = trim($bits[1]);

            if ($key === 'user-agent') {
                if ($inGroup) {
                    foreach ($agents as $a) {
                        $groups[$a] = array_merge($groups[$a] ?? [], $current);
                    }
                    $agents  = [];
                    $current = [];
                    $inGroup = false;
                }
                $agents[] = strtolower($val);
                continue;
            }
            if ($key === 'disallow') {
                $inGroup = true;
                if ($val !== '') {
                    $current[] = $val;
                }
            }
        }
        foreach ($agents as $a) {
            $groups[$a] = array_merge($groups[$a] ?? [], $current);
        }

        $uaLower = strtolower($ua);
        foreach ($groups as $agent => $rules) {
            if ($agent !== '*' && $agent !== '' && strpos($uaLower, $agent) !== false) {
                return $rules;
            }
        }
        return $groups['*'] ?? [];
    }

    private function blank(string $url): array
    {
        return [
            'ok'           => false,
            'url'          => $url,
            'final_url'    => $url,
            'status'       => 0,
            'body'         => '',
            'headers'      => [],
            'content_type' => '',
            'bytes'        => 0,
            'total_bytes'  => 0,
            'ttfb'         => 0.0,
            'total'        => 0.0,
            'error'        => '',
            'redirects'    => [],
            'truncated'    => false,
        ];
    }
}
