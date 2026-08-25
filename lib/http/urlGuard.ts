import dns from 'dns';
import { promisify } from 'util';

const lookup = promisify(dns.lookup);
const resolve6 = promisify(dns.resolve6);

export interface UrlCheckOk {
  ok: true;
  error: '';
  normalised: string;
  host: string;
  port: number;
  ip: string;
  scheme: string;
}

export interface UrlCheckFail {
  ok: false;
  error: string;
  normalised: '';
  host: '';
  port: 0;
  ip: '';
  scheme: '';
}

export type UrlCheckResult = UrlCheckOk | UrlCheckFail;

function fail(msg: string): UrlCheckFail {
  return { ok: false, error: msg, normalised: '', host: '', port: 0, ip: '', scheme: '' };
}

/** Resolve to a single IP, preferring IPv4. */
async function resolve(host: string): Promise<string | null> {
  if (isIpLiteral(host)) {
    return host.replace(/^\[|\]$/g, '');
  }
  try {
    const v4 = await lookup(host, { family: 4 });
    if (v4?.address) return v4.address;
  } catch {
    // try v6
  }
  try {
    const records = await resolve6(host);
    if (records?.[0]) return records[0];
  } catch {
    // none
  }
  try {
    const any = await lookup(host, { all: false });
    if (any?.address) return any.address;
  } catch {
    // none
  }
  return null;
}

function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(h)) return true;
  if (h.includes(':')) return true;
  return false;
}

export function isPublicIp(ip: string): boolean {
  const cleaned = ip.replace(/^\[|\]$/g, '');
  // IPv4 private / reserved
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast / reserved
    return true;
  }
  // IPv6
  const lower = cleaned.toLowerCase();
  if (lower === '::1' || lower === '::') return false;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false; // ULA
  if (lower.startsWith('fe80')) return false; // link-local
  if (lower.startsWith('ff')) return false; // multicast
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7);
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(mapped)) {
      return isPublicIp(mapped);
    }
  }
  return true;
}

/**
 * Normalise a user-supplied URL, resolve the host once, reject private targets.
 */
export async function check(url: string, allowPrivate = false): Promise<UrlCheckResult> {
  let input = url.trim();
  if (input === '') return fail('Empty URL');
  if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(input)) {
    input = 'https://' + input.replace(/^\/+/, '');
  }

  let parts: URL;
  try {
    parts = new URL(input);
  } catch {
    return fail('Could not read that URL');
  }

  const scheme = parts.protocol.replace(':', '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    return fail('Only http and https URLs are supported');
  }
  if (parts.username || parts.password) {
    return fail('URLs with embedded credentials are not allowed');
  }

  let host = parts.hostname.toLowerCase().replace(/\.$/, '');
  // IDNA: URL constructor already punycodes hostname in Node
  if (host === '' || host.length > 253) {
    return fail('Invalid hostname');
  }

  const port = parts.port
    ? Number.parseInt(parts.port, 10)
    : scheme === 'https'
      ? 443
      : 80;
  if (![80, 443, 8080, 8443].includes(port)) {
    return fail(`Port ${port} is not allowed`);
  }

  const ip = await resolve(host);
  if (ip === null) {
    return fail(`DNS lookup failed for ${host}`);
  }
  if (!allowPrivate && !isPublicIp(ip)) {
    return fail('That hostname resolves to a private address');
  }

  const pathPart = parts.pathname === '' ? '/' : parts.pathname;
  const query = parts.search || '';
  const portPart = [80, 443].includes(port) ? '' : `:${port}`;
  const norm = `${scheme}://${host}${portPart}${pathPart}${query}`;

  return {
    ok: true,
    error: '',
    normalised: norm,
    host,
    port,
    ip,
    scheme,
  };
}

/** Resolve a possibly-relative URL against a base. Returns null when unusable. */
export function resolveRelative(base: string, rel: string): string | null {
  const r = rel.trim();
  if (r === '' || r.startsWith('#')) return null;
  if (/^(javascript|mailto|tel|data|whatsapp|sms|intent):/i.test(r)) return null;
  if (/^https?:\/\//i.test(r)) return r;
  if (r.startsWith('//')) {
    try {
      const scheme = new URL(base).protocol.replace(':', '') || 'https';
      return `${scheme}:${r}`;
    } catch {
      return `https:${r}`;
    }
  }

  let b: URL;
  try {
    b = new URL(base);
  } catch {
    return null;
  }
  const origin = `${b.protocol}//${b.host}`;

  if (r.startsWith('/')) {
    return origin + tidyPath(r);
  }

  const dir = (b.pathname === '' || b.pathname === '/' ? '/' : b.pathname).replace(/\/[^/]*$/, '') || '';
  const dirClean = dir.replace(/\/$/, '');
  return origin + tidyPath(`${dirClean}/${r}`);
}

/** Collapse ./ and ../ segments. */
function tidyPath(p: string): string {
  let query = '';
  const qPos = p.indexOf('?');
  let pathOnly = p;
  if (qPos !== -1) {
    query = p.slice(qPos);
    pathOnly = p.slice(0, qPos);
  }
  const out: string[] = [];
  for (const segment of pathOnly.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const trailing = pathOnly.endsWith('/') ? '/' : '';
  return '/' + out.join('/') + (out.length ? trailing : '') + query;
}

/** registrable-ish host without www, for same-site comparisons */
export function baseHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function sameSite(a: string, b: string): boolean {
  const ha = baseHost(a);
  const hb = baseHost(b);
  if (ha === '' || hb === '') return false;
  if (ha === hb) return true;
  return ha.endsWith('.' + hb) || hb.endsWith('.' + ha);
}

const UrlGuard = {
  check,
  isPublicIp,
  resolveRelative,
  baseHost,
  sameSite,
};

export default UrlGuard;
