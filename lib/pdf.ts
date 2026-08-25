/**
 * Minimal PDF metadata reader — port of Support/Pdf.php.
 */
export interface PdfMeta {
  is_pdf: boolean;
  title: string | null;
  producer: string | null;
  creator: string | null;
  created: string | null;
  modified: string | null;
  pages: number | null;
}

export function meta(head: string | Buffer): PdfMeta {
  const buf = typeof head === 'string' ? Buffer.from(head, 'binary') : head;
  const headStr = buf.toString('latin1');
  const out: PdfMeta = {
    is_pdf: headStr.startsWith('%PDF-'),
    title: null,
    producer: null,
    creator: null,
    created: null,
    modified: null,
    pages: null,
  };
  if (headStr === '') return out;

  for (const [key, marker] of [
    ['title', '/Title'],
    ['producer', '/Producer'],
    ['creator', '/Creator'],
  ] as const) {
    const val = infoString(headStr, marker);
    if (val !== null && val !== '') {
      out[key] = val;
    }
  }
  for (const [key, marker] of [
    ['created', '/CreationDate'],
    ['modified', '/ModDate'],
  ] as const) {
    const raw = infoString(headStr, marker);
    if (raw !== null) {
      const iso = pdfDate(raw);
      if (iso !== null) out[key] = iso;
    }
  }

  if (out.created === null) {
    const m1 = headStr.match(/<xmp:CreateDate>([^<]+)</i);
    if (m1) out.created = isoDate(m1[1]);
  }
  if (out.created === null) {
    const m1 = headStr.match(/xmp:CreateDate="([^"]+)"/i);
    if (m1) out.created = isoDate(m1[1]);
  }
  if (out.modified === null) {
    const m1 = headStr.match(/<xmp:ModifyDate>([^<]+)</i);
    if (m1) out.modified = isoDate(m1[1]);
  }
  if (out.modified === null) {
    const m1 = headStr.match(/xmp:ModifyDate="([^"]+)"/i);
    if (m1) out.modified = isoDate(m1[1]);
  }
  if (out.title === null) {
    const m1 = headStr.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]{1,200})<\/rdf:li>/i);
    if (m1) out.title = m1[1].trim();
  }
  if (out.producer === null) {
    const m1 = headStr.match(/<pdf:Producer>([^<]{1,120})</i);
    if (m1) out.producer = m1[1].trim();
  }
  if (out.creator === null) {
    const m1 = headStr.match(/<xmp:CreatorTool>([^<]{1,120})</i);
    if (m1) out.creator = m1[1].trim();
  }

  const pageM = headStr.match(/\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d{1,5})/);
  if (pageM) out.pages = Number.parseInt(pageM[1], 10);

  for (const k of ['title', 'producer', 'creator'] as const) {
    if (typeof out[k] === 'string') {
      out[k] = clean(out[k]!);
      if (out[k] === '') out[k] = null;
    }
  }

  return out;
}

function infoString(head: string, marker: string): string | null {
  const q = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lit = new RegExp(q + String.raw`\s*\(((?:\\.|[^()\\])*)\)`, 's');
  const m1 = head.match(lit);
  if (m1) return unescapePdf(m1[1]);
  const hex = new RegExp(q + String.raw`\s*<([0-9A-Fa-f\s]+)>`, 's');
  const m2 = head.match(hex);
  if (m2) {
    let h = m2[1].replace(/\s+/g, '');
    if (h.length % 2 !== 0) h = h.slice(0, -1);
    try {
      return decodeText(Buffer.from(h, 'hex').toString('binary'));
    } catch {
      return null;
    }
  }
  return null;
}

function unescapePdf(s: string): string {
  const mapped: Record<string, string> = {
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\x08',
    f: '\x0c',
    '(': '(',
    ')': ')',
    '\\': '\\',
  };
  const out = s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, g: string) => {
    if (mapped[g] !== undefined) return mapped[g];
    return String.fromCharCode(Number.parseInt(g, 8));
  });
  return decodeText(out);
}

function decodeText(s: string): string {
  if (s.startsWith('\xFE\xFF')) {
    try {
      return Buffer.from(s.slice(2), 'binary').toString('utf16le'); // wrong endian
    } catch {
      // fall through
    }
    // UTF-16BE
    const buf = Buffer.from(s.slice(2), 'binary');
    const swapped = Buffer.alloc(buf.length);
    for (let i = 0; i + 1 < buf.length; i += 2) {
      swapped[i] = buf[i + 1];
      swapped[i + 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  return s;
}

function clean(s: string): string {
  return s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function pdfDate(raw: string): string | null {
  const m = raw.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const y = Number.parseInt(m[1], 10);
    const maxY = new Date().getUTCFullYear() + 1;
    if (y >= 1990 && y <= maxY) {
      const mo = Math.max(1, Number.parseInt(m[2], 10));
      const d = Math.max(1, Number.parseInt(m[3], 10));
      return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

function isoDate(raw: string): string | null {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function isOfficeExport(...fields: (string | null | undefined)[]): boolean {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  if (hay === '') return false;
  for (const needle of [
    'microsoft® word',
    'microsoft word',
    'microsoft® powerpoint',
    'microsoft powerpoint',
    'microsoft® excel',
    'microsoft excel',
    'wps ',
    'libreoffice',
    'openoffice',
    'google docs',
    'google slides',
    'skia/pdf',
  ]) {
    if (hay.includes(needle)) return true;
  }
  return false;
}

const Pdf = { meta, isOfficeExport };
export default Pdf;
