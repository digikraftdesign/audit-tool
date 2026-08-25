import dns from 'dns';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { check as urlCheck, resolveRelative, type UrlCheckResult } from '@/lib/http/urlGuard';

export interface HttpResult {
  ok: boolean;
  url: string;
  final_url: string;
  status: number;
  body: string;
  headers: Record<string, string>;
  content_type: string;
  bytes: number;
  total_bytes: number;
  ttfb: number;
  total: number;
  error: string;
  redirects: string[];
  truncated: boolean;
}

export interface HttpConfig {
  timeout: number;
  connect_timeout: number;
  max_bytes: number;
  max_redirects: number;
  user_agent: string;
  allow_private_hosts: boolean;
  obey_robots: boolean;
}

type RobotsCache = { allowed: boolean; rules: string[] };

function blank(url: string): HttpResult {
  return {
    ok: false,
    url,
    final_url: url,
    status: 0,
    body: '',
    headers: {},
    content_type: '',
    bytes: 0,
    total_bytes: 0,
    ttfb: 0,
    total: 0,
    error: '',
    redirects: [],
    truncated: false,
  };
}

function fullSize(headers: Record<string, string>, downloaded: number): number {
  const cr = headers['content-range'];
  if (cr) {
    const m = cr.match(/\/(\d+)\s*$/);
    if (m) return Number.parseInt(m[1], 10);
  }
  if (headers['content-length']) {
    return Number.parseInt(headers['content-length'], 10) || 0;
  }
  return downloaded > 0 ? downloaded : 0;
}

export class Http {
  private cfg: HttpConfig;
  private robots: Record<string, RobotsCache> = {};

  constructor(cfg: Partial<HttpConfig> = {}) {
    this.cfg = {
      timeout: 12,
      connect_timeout: 6,
      max_bytes: 2500000,
      max_redirects: 4,
      user_agent: 'DigiKraftAuditBot/1.0',
      allow_private_hosts: false,
      obey_robots: true,
      ...cfg,
    };
  }

  async get(url: string, headOnly = false): Promise<HttpResult> {
    const result = blank(url);
    const chain: string[] = [];
    let target = url;

    for (let hop = 0; hop <= this.cfg.max_redirects; hop++) {
      const checked = await urlCheck(target, this.cfg.allow_private_hosts);
      if (!checked.ok) {
        result.error = checked.error;
        return result;
      }
      if (this.cfg.obey_robots && !headOnly && !(await this.robotsAllows(checked.normalised, checked.ip))) {
        result.error = 'Blocked by robots.txt';
        result.status = 999;
        return result;
      }

      const one = await this.raw(checked, headOnly);
      one.redirects = [...chain];
      one.url = url;

      const location = one.headers['location'] ?? '';
      if (one.status >= 300 && one.status < 400 && location !== '') {
        const next = resolveRelative(checked.normalised, location);
        if (next === null) {
          one.error = 'Unresolvable redirect: ' + location;
          return one;
        }
        chain.push(next);
        target = next;
        continue;
      }

      return one;
    }

    result.error = 'Too many redirects';
    result.redirects = chain;
    return result;
  }

  async getMany(urls: string[], deadline = 0): Promise<Record<string, HttpResult>> {
    const unique = [...new Set(urls.filter(Boolean))];
    const out: Record<string, HttpResult> = {};
    if (!unique.length) return out;

    await Promise.all(
      unique.map(async (url) => {
        if (deadline > 0 && Date.now() / 1000 > deadline) {
          out[url] = { ...blank(url), error: 'Deadline reached' };
          return;
        }
        const checked = await urlCheck(url, this.cfg.allow_private_hosts);
        if (!checked.ok) {
          out[url] = { ...blank(url), error: checked.error };
          return;
        }
        if (this.cfg.obey_robots && !(await this.robotsAllows(checked.normalised, checked.ip))) {
          out[url] = { ...blank(url), error: 'Blocked by robots.txt', status: 999 };
          return;
        }
        out[url] = await this.raw(checked, false);
        out[url].url = url;
      }),
    );

    // Second pass: redirects through guarded get()
    let redirects = 0;
    for (const url of Object.keys(out)) {
      if (redirects >= 4) break;
      const row = out[url];
      if (row.status < 300 || row.status >= 400 || !row.headers['location']) continue;
      if (deadline > 0 && Date.now() / 1000 > deadline) break;
      redirects++;
      const followed = await this.get(url);
      followed.url = url;
      out[url] = followed;
    }

    return out;
  }

  async getRange(url: string, bytes = 262144, depth = 0): Promise<HttpResult> {
    const checked = await urlCheck(url, this.cfg.allow_private_hosts);
    if (!checked.ok) {
      return { ...blank(url), error: checked.error };
    }

    const row = await this.raw(checked, false, bytes, { Range: `bytes=0-${bytes - 1}` });
    row.total_bytes = fullSize(row.headers, row.bytes);

    if (row.status >= 300 && row.status < 400 && row.headers['location'] && depth < 3) {
      const next = resolveRelative(checked.normalised, row.headers['location']);
      if (next !== null) {
        return this.getRange(next, bytes, depth + 1);
      }
    }

    return row;
  }

  private async raw(
    checked: Extract<UrlCheckResult, { ok: true }>,
    headOnly: boolean,
    cap?: number,
    extraHeaders: Record<string, string> = {},
  ): Promise<HttpResult> {
    const maxBytes = cap ?? this.cfg.max_bytes;
    const url = checked.normalised;
    const start = Date.now();
    let ttfb = 0;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (row: HttpResult) => {
        if (settled) return;
        settled = true;
        resolve(row);
      };

      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const headers: Record<string, string> = {
        Host: checked.host + (checked.port !== 80 && checked.port !== 443 ? `:${checked.port}` : ''),
        'User-Agent': this.cfg.user_agent,
        Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Accept-Encoding': 'identity',
        Connection: 'close',
        ...extraHeaders,
      };

      const options: http.RequestOptions & { servername?: string } = {
        protocol: parsed.protocol,
        hostname: checked.ip.includes(':') ? checked.ip : checked.ip,
        port: checked.port,
        path: parsed.pathname + parsed.search,
        method: headOnly ? 'HEAD' : 'GET',
        headers,
        timeout: this.cfg.timeout * 1000,
        servername: isHttps ? checked.host : undefined,
        lookup: (
          _hostname: string,
          opts: dns.LookupOneOptions | dns.LookupAllOptions | number | undefined,
          cb: (
            err: NodeJS.ErrnoException | null,
            address: string | dns.LookupAddress[],
            family?: number,
          ) => void,
        ) => {
          const family = checked.ip.includes(':') ? 6 : 4;
          if (typeof opts === 'object' && opts && 'all' in opts && opts.all) {
            (cb as (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void)(
              null,
              [{ address: checked.ip, family }],
            );
          } else {
            (cb as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
              null,
              checked.ip,
              family,
            );
          }
        },
      };

      const req = lib.request(options, (res) => {
        ttfb = (Date.now() - start) / 1000;
        const headersLower: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue;
          headersLower[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;

        res.on('data', (chunk: Buffer) => {
          if (headOnly) return;
          if (size >= maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          const take = chunk.subarray(0, maxBytes - size);
          chunks.push(take);
          size += take.length;
          if (chunk.length > take.length) {
            truncated = true;
            res.destroy();
          }
        });

        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const ct = (headersLower['content-type'] ?? '').split(';')[0].trim().toLowerCase();
          const status = res.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          const row = blank(url);
          row.final_url = url;
          row.status = status;
          row.content_type = ct;
          row.ttfb = Math.round(ttfb * 1000) / 1000;
          row.total = Math.round(((Date.now() - start) / 1000) * 1000) / 1000;
          row.headers = headersLower;
          row.body = body;
          row.bytes = headOnly
            ? Number.parseInt(headersLower['content-length'] ?? '0', 10) || 0
            : Buffer.byteLength(body);
          row.truncated = truncated || row.bytes >= maxBytes;
          row.ok = ok && (!headOnly || true);
          if (!headOnly) {
            // PHP: ok requires status 2xx (body may be empty for HEAD)
            row.ok = status >= 200 && status < 300;
          }
          row.error = row.ok ? '' : status ? `HTTP ${status}` : 'No response';
          finish(row);
        });

        res.on('error', (err) => {
          const row = blank(url);
          row.error = err.message;
          row.ttfb = Math.round(ttfb * 1000) / 1000;
          row.total = Math.round(((Date.now() - start) / 1000) * 1000) / 1000;
          finish(row);
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('Timeout'));
      });

      req.on('error', (err) => {
        const row = blank(url);
        row.error = err.message || 'No response';
        row.total = Math.round(((Date.now() - start) / 1000) * 1000) / 1000;
        finish(row);
      });

      // Connect timeout
      req.setTimeout(this.cfg.timeout * 1000);
      const connectTimer = setTimeout(() => {
        req.destroy(new Error('Connect timeout'));
      }, this.cfg.connect_timeout * 1000);
      req.on('socket', (socket) => {
        socket.on('connect', () => clearTimeout(connectTimer));
      });
      req.on('close', () => clearTimeout(connectTimer));

      req.end();
    });
  }

  private async robotsAllows(url: string, ip: string): Promise<boolean> {
    let parts: URL;
    try {
      parts = new URL(url);
    } catch {
      return true;
    }
    const origin = `${parts.protocol}//${parts.host}`;
    const pathName = parts.pathname || '/';

    if (!this.robots[origin]) {
      this.robots[origin] = { allowed: true, rules: [] };
      const port = parts.port
        ? Number.parseInt(parts.port, 10)
        : parts.protocol === 'https:'
          ? 443
          : 80;
      const robotsUrl = `${origin}/robots.txt`;
      try {
        const checked = {
          ok: true as const,
          error: '' as const,
          normalised: robotsUrl,
          host: parts.hostname,
          port,
          ip,
          scheme: parts.protocol.replace(':', ''),
        };
        const prevTimeout = this.cfg.timeout;
        this.cfg.timeout = 6;
        const res = await this.raw(checked, false, 120000);
        this.cfg.timeout = prevTimeout;
        if (res.status === 200 && res.body !== '') {
          this.robots[origin].rules = this.parseRobots(res.body, this.cfg.user_agent);
        }
      } catch {
        // allow on failure
      }
    }

    for (const rule of this.robots[origin].rules) {
      if (rule !== '' && pathName.startsWith(rule)) {
        return false;
      }
    }
    return true;
  }

  private parseRobots(text: string, ua: string): string[] {
    const lines = text.split(/\r\n|\r|\n/);
    const groups: Record<string, string[]> = {};
    let current: string[] = [];
    let agents: string[] = [];
    let inGroup = false;

    for (let line of lines) {
      line = line.replace(/#.*$/, '').trim();
      if (line === '') continue;
      const bits = line.split(':', 2);
      if (bits.length !== 2) continue;
      const key = bits[0].trim().toLowerCase();
      const val = bits[1].trim();

      if (key === 'user-agent') {
        if (inGroup) {
          for (const a of agents) {
            groups[a] = [...(groups[a] ?? []), ...current];
          }
          agents = [];
          current = [];
          inGroup = false;
        }
        agents.push(val.toLowerCase());
        continue;
      }
      if (key === 'disallow') {
        inGroup = true;
        if (val !== '') current.push(val);
      }
    }
    for (const a of agents) {
      groups[a] = [...(groups[a] ?? []), ...current];
    }

    const uaLower = ua.toLowerCase();
    for (const [agent, rules] of Object.entries(groups)) {
      if (agent !== '*' && agent !== '' && uaLower.includes(agent)) {
        return rules;
      }
    }
    return groups['*'] ?? [];
  }
}

export default Http;
