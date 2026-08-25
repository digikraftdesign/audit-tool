export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function trimUrl(u: unknown): string {
  return String(u || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

export function clip(t: unknown, max: number): string {
  const s = String(t || '').trim();
  if (!s) return '—';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function bytes(n: unknown): string {
  const v = Number(n) || 0;
  if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB';
  if (v >= 1024) return Math.round(v / 1024) + ' KB';
  return v + ' B';
}

export function subjectLabel(r: {
  type: string;
  metrics?: Record<string, unknown> | null;
  subject?: string;
}): string {
  if (r.type === 'document') {
    const m = r.metrics as { name?: string } | undefined;
    return m?.name || r.subject || 'the document';
  }
  if (r.type === 'social') {
    const profiles =
      (r.metrics as { profiles?: Record<string, unknown> } | undefined)
        ?.profiles || {};
    const n = Object.keys(profiles).length;
    return n + ' profile' + (n === 1 ? '' : 's');
  }
  return trimUrl(r.subject);
}

export const MONTH_TITLES: Record<
  number,
  { kicker: string; head: string }
> = {
  1: { kicker: 'Month 1 — Learn & build', head: 'Immersion and the system.' },
  2: { kicker: 'Month 2 — Produce & test', head: 'Variants in market.' },
  3: { kicker: 'Month 3 — Optimize & scale', head: 'Launch kit and enablement.' },
};

export const VIEWS = [
  'landing',
  'intake',
  'scan',
  'workspace',
  'report',
  'close',
] as const;

export const STORAGE_KEY = 'dk-cga-session-v4';
