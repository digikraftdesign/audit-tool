import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '@/lib/config';

const ROOT = process.cwd();

export function token(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

/** UTC timestamp matching PHP gmdate('Y-m-d H:i:s'). */
export function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Client IP from request headers (CF / X-Forwarded-For / fallback).
 * Pass a Headers-like object or a plain Record.
 */
export function clientIp(
  headers?: Headers | Record<string, string | string[] | undefined> | null,
): string {
  const get = (key: string): string => {
    if (!headers) return '';
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(key) ?? '';
    }
    const rec = headers as Record<string, string | string[] | undefined>;
    const v = rec[key] ?? rec[key.toLowerCase()];
    return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  };

  for (const key of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip']) {
    const raw = get(key);
    if (!raw) continue;
    const val = raw.split(',')[0]?.trim() ?? '';
    if (val && isIp(val)) return val;
  }
  return '0.0.0.0';
}

function isIp(val: string): boolean {
  // IPv4
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(val)) {
    return val.split('.').every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255;
    });
  }
  // Loose IPv6
  if (val.includes(':') && /^[0-9a-fA-F:.]+$/.test(val)) return true;
  return false;
}

export function storagePath(rel = ''): string {
  const base = path.join(ROOT, 'storage');
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return rel === '' ? base : path.join(base, rel.replace(/^[/\\]+/, ''));
}

/**
 * Where the SQLite database lives.
 * Filename is unguessable; remembered in storage/db-name.php (or .json for Node).
 */
export function defaultSqlitePath(): string {
  const legacy = storagePath('audits.sqlite');
  if (fs.existsSync(legacy)) {
    return legacy;
  }

  const pointerJson = storagePath('db-name.json');
  const pointerPhp = storagePath('db-name.php');

  if (fs.existsSync(pointerJson)) {
    try {
      const name = JSON.parse(fs.readFileSync(pointerJson, 'utf8')) as string;
      if (typeof name === 'string' && /^audits-[0-9a-f]{16,}\.sqlite$/.test(name)) {
        return storagePath(name);
      }
    } catch {
      // fall through
    }
  }

  if (fs.existsSync(pointerPhp)) {
    const raw = fs.readFileSync(pointerPhp, 'utf8');
    const m = raw.match(/return\s+'([^']+)';/);
    if (m?.[1] && /^audits-[0-9a-f]{16,}\.sqlite$/.test(m[1])) {
      return storagePath(m[1]);
    }
  }

  const name = `audits-${token(12)}.sqlite`;
  fs.writeFileSync(pointerJson, JSON.stringify(name), 'utf8');
  // Also write PHP-style pointer for parity with legacy installs
  fs.writeFileSync(
    pointerPhp,
    `<?php\n// Generated on first run. Keeps the database filename unguessable\n`
      + `// on hosts that ignore .htaccess. Do not edit or the app loses its data.\nreturn '${name}';\n`,
    'utf8',
  );
  return storagePath(name);
}

/** Remove staged uploads older than the retention window. */
export function pruneUploads(runDelete?: (sql: string, args: unknown[]) => void): void {
  const dir = storagePath('uploads');
  if (!fs.existsSync(dir)) return;

  const ttl = Number(config('upload.keep_hours', 24)) * 3600;
  const cut = Math.floor(Date.now() / 1000) - Math.max(3600, ttl);
  const cutIso = new Date(cut * 1000).toISOString().replace('T', ' ').slice(0, 19);

  try {
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && st.mtimeMs / 1000 < cut) {
          fs.unlinkSync(full);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  try {
    runDelete?.('DELETE FROM dk_uploads WHERE created_at < ?', [cutIso]);
  } catch {
    // pruning is housekeeping; never let it break a request
  }
}
