import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';
import { Html } from '@/lib/html';
import Pdf from '@/lib/pdf';

export interface DocRun {
  text: string;
  size: number;
  font: string;
  color: string | null;
  newline: boolean;
  level?: number;
  list?: boolean;
}

export interface DocTextResult {
  ok: boolean;
  error: string;
  kind: string;
  bytes: number;
  text: string;
  words: number;
  lines: number;
  pages: number | null;
  headings: Array<{ level: number; text: string; size: number }>;
  paragraphs: string[];
  list_items: number;
  fonts: string[];
  sizes: Record<string, number>;
  colors: Record<string, number>;
  body_size: number;
  lang: string;
  tagged: boolean;
  title: string;
  producer: string;
  creator: string;
  created: string | null;
  modified: string | null;
  cmapped: boolean;
}

function blank(): DocTextResult {
  return {
    ok: false,
    error: '',
    kind: '',
    bytes: 0,
    text: '',
    words: 0,
    lines: 0,
    pages: null,
    headings: [],
    paragraphs: [],
    list_items: 0,
    fonts: [],
    sizes: {},
    colors: {},
    body_size: 0,
    lang: '',
    tagged: false,
    title: '',
    producer: '',
    creator: '',
    created: null,
    modified: null,
    cmapped: false,
  };
}

function cleanFontName(name: string): string {
  let n = name.replace(/^[A-Z]{6}\+/, '');
  n = n.replace(/[,-](Bold|Italic|Oblique|Regular|Light|Medium|Semibold|Black|BoldItalic|MT|PS)$/i, '');
  n = n.replace(/#20/g, ' ');
  return n.trim();
}

function fromRuns(out: DocTextResult, runs: DocRun[], skipRunFonts = false): DocTextResult {
  const lines: Array<{ text: string; size: number; level: number; list: boolean }> = [];
  let current: { text: string; size: number; level: number; list: boolean } | null = null;

  for (const run of runs) {
    const text = String(run.text);
    if (text.trim() === '') continue;
    const size = Number(run.size ?? 0);
    if (size > 0) {
      const key = String(Math.round(size * 10) / 10);
      out.sizes[key] = (out.sizes[key] ?? 0) + Math.max(1, [...text].length);
    }
    if (!skipRunFonts && run.font) {
      out.fonts.push(cleanFontName(String(run.font)));
    }
    if (run.color) {
      out.colors[run.color] = (out.colors[run.color] ?? 0) + Math.max(1, [...text].length);
    }

    if (run.newline || current === null) {
      if (current !== null) lines.push(current);
      current = {
        text,
        size,
        level: Number(run.level ?? 0),
        list: Boolean(run.list ?? false),
      };
    } else {
      current.text += text;
      current.size = Math.max(current.size, size);
    }
  }
  if (current !== null) lines.push(current);

  let bodySize = 0;
  if (Object.keys(out.sizes).length) {
    const sorted = Object.entries(out.sizes).sort((a, b) => b[1] - a[1]);
    bodySize = Number.parseFloat(sorted[0][0]);
  }

  const textParts: string[] = [];
  const headings: DocTextResult['headings'] = [];
  const paragraphs: string[] = [];
  let listItems = 0;

  for (const line of lines) {
    const clean = line.text.replace(/\s+/gu, ' ').trim();
    if (clean === '') continue;
    textParts.push(clean);

    const words = clean.split(/\s+/u).filter(Boolean).length;
    const isHeadingByMarkup = line.level > 0;
    const isHeadingBySize = bodySize > 0 && line.size >= bodySize * 1.18 && words <= 14;
    const isHeadingByCase =
      words <= 10 &&
      words >= 1 &&
      /^[A-Z0-9]/.test(clean) &&
      !/[.!?]$/.test(clean) &&
      clean.toUpperCase() === clean &&
      [...clean].length > 3;

    if (line.list) {
      listItems++;
      continue;
    }
    if (isHeadingByMarkup || isHeadingBySize || isHeadingByCase) {
      headings.push({
        level: line.level || (isHeadingBySize ? 2 : 3),
        text: clean,
        size: line.size,
      });
      continue;
    }
    if (/^\s*[-•*‣▪]\s?/u.test(clean)) {
      listItems++;
      continue;
    }
    paragraphs.push(clean);
  }

  out.lines = lines.length;
  out.text = textParts.join('\n');
  out.headings = headings;
  out.paragraphs = paragraphs;
  out.list_items = listItems;
  out.body_size = bodySize;
  return out;
}

function finish(out: DocTextResult): DocTextResult {
  out.fonts = [
    ...new Set(
      out.fonts
        .map((f) => f.trim())
        .filter(Boolean)
        .filter((f) => !/^(F|TT|C|G|T)\d{1,3}$/i.test(f) && [...f].length > 2),
    ),
  ];
  out.colors = Object.fromEntries(
    Object.entries(out.colors).sort((a, b) => b[1] - a[1]),
  );
  out.sizes = Object.fromEntries(
    Object.entries(out.sizes).sort((a, b) => b[1] - a[1]),
  );
  const text = String(out.text);
  out.words = text === '' ? 0 : text.trim().split(/\s+/u).filter(Boolean).length;
  return out;
}

async function readPdf(bytes: Buffer): Promise<DocTextResult> {
  const out = blank();
  out.ok = true;
  const latin = bytes.toString('latin1');
  const meta = Pdf.meta(bytes);
  out.title = String(meta.title ?? '');
  out.producer = String(meta.producer ?? '');
  out.creator = String(meta.creator ?? '');
  out.created = meta.created;
  out.modified = meta.modified;
  out.pages = meta.pages;
  out.tagged = latin.includes('/StructTreeRoot');
  const langM = latin.match(/\/Lang\s*\(([^)]{2,12})\)/);
  if (langM) out.lang = langM[1].trim();

  try {
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    const textResult = await parser.getText();
    await parser.destroy();
    const text = (textResult?.text ?? '').trim();
    if (!text) {
      out.error = 'No text layer found — the file is a picture of a document.';
      return out;
    }
    const runs: DocRun[] = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      const t = line.trim();
      if (t === '') continue;
      runs.push({ text: t, size: 0, font: '', color: null, newline: true });
    }
    // Heuristic font names from BaseFont markers
    const fontRe = /\/BaseFont\s*\/([A-Za-z0-9#+.\-,_]+)/g;
    let fm: RegExpExecArray | null;
    while ((fm = fontRe.exec(latin)) !== null) {
      out.fonts.push(cleanFontName(fm[1].replace(/#20/g, ' ')));
    }
    return fromRuns(out, runs, true);
  } catch {
    out.error = 'No readable content stream — the file is probably scanned images.';
    return out;
  }
}

async function readOfficeZip(bytes: Buffer, kind: 'docx' | 'pptx'): Promise<DocTextResult> {
  const out = blank();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    out.error = 'The file is not a readable Office document.';
    return out;
  }

  let xml = '';
  if (kind === 'docx') {
    xml = (await zip.file('word/document.xml')?.async('string')) ?? '';
  } else {
    for (let i = 1; i <= 60; i++) {
      const slide = await zip.file(`ppt/slides/slide${i}.xml`)?.async('string');
      if (!slide) break;
      xml += slide;
    }
  }
  const styles =
    (await zip
      .file(kind === 'docx' ? 'word/styles.xml' : 'ppt/theme/theme1.xml')
      ?.async('string')) ?? '';
  const core = (await zip.file('docProps/core.xml')?.async('string')) ?? '';
  const app = (await zip.file('docProps/app.xml')?.async('string')) ?? '';

  if (xml === '') {
    out.error = 'The document body could not be read.';
    return out;
  }

  out.ok = true;
  const titleM = core.match(/<dc:title>([^<]*)<\/dc:title>/);
  if (titleM) out.title = titleM[1].trim();
  const creatorM = core.match(/<cp:lastModifiedBy>([^<]*)/);
  if (creatorM) out.creator = creatorM[1].trim();
  const appM = app.match(/<Application>([^<]*)/);
  if (appM) out.producer = appM[1].trim();
  const modM = core.match(/<dcterms:modified[^>]*>(\d{4}-\d{2}-\d{2})/);
  if (modM) out.modified = modM[1];
  const creM = core.match(/<dcterms:created[^>]*>(\d{4}-\d{2}-\d{2})/);
  if (creM) out.created = creM[1];
  const pagesM = app.match(/<Pages>(\d+)/);
  if (pagesM) out.pages = Number.parseInt(pagesM[1], 10);
  const langM = xml.match(/w:lang[^>]*w:val="([a-zA-Z-]+)"/);
  if (langM) out.lang = langM[1];

  const runs: DocRun[] = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(xml)) !== null) {
    const para = pm[1];
    let text = para.replace(/<w:tab[^>]*\/>/g, ' ');
    text = text.replace(/<[^>]+>/g, '');
    text = text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    text = text.replace(/\s+/gu, ' ').trim();
    if (text === '') continue;

    let level = 0;
    const hm = para.match(/w:pStyle[^>]*w:val="(?:Heading|heading)\s*(\d)/);
    if (hm) level = Number.parseInt(hm[1], 10);
    else if (/w:pStyle[^>]*w:val="(Title|Subtitle)"/.test(para)) level = 1;
    const isList = para.includes('<w:numPr');
    let size = 0;
    const sm = para.match(/<w:sz w:val="(\d+)"/);
    if (sm) size = Number.parseInt(sm[1], 10) / 2;
    const fm = para.match(/w:ascii="([^"]+)"/);
    if (fm) out.fonts.push(fm[1]);
    const cm = para.match(/<w:color w:val="([0-9A-Fa-f]{6})"/);
    if (cm) {
      const key = '#' + cm[1].toLowerCase();
      out.colors[key] = (out.colors[key] ?? 0) + 1;
    }
    // Also extract ppt text runs
    runs.push({
      text,
      size,
      font: '',
      color: null,
      newline: true,
      level,
      list: isList,
    });
  }

  // PPTX: a:t text nodes when no w:p
  if (!runs.length) {
    const tRe = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    let tm: RegExpExecArray | null;
    const chunks: string[] = [];
    while ((tm = tRe.exec(xml)) !== null) {
      const t = tm[1].trim();
      if (t) chunks.push(t);
    }
    for (const t of chunks) {
      runs.push({ text: t, size: 0, font: '', color: null, newline: true });
    }
  }

  const styleFonts = styles.matchAll(/w:ascii="([^"]+)"/g);
  for (const m of styleFonts) out.fonts.push(m[1]);

  if (!runs.length) {
    out.error = 'No paragraphs found in the document body.';
    return out;
  }
  return fromRuns(out, runs);
}

function readHtml(bytes: string): DocTextResult {
  const out = blank();
  const h = new Html('https://document.local/', bytes);
  if (!h.ok()) {
    out.error = 'The HTML could not be parsed.';
    return out;
  }
  out.ok = true;
  out.title = h.title();
  out.lang = h.attr('html', 'lang');

  const runs: DocRun[] = [];
  const $ = cheerio.load(bytes);
  $('h1,h2,h3,h4,p,li,td,blockquote').each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/gu, ' ').trim();
    if (!text) return;
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
    const level = ['h1', 'h2', 'h3', 'h4'].includes(tag) ? Number.parseInt(tag.slice(1), 10) : 0;
    runs.push({
      text,
      size: 0,
      font: '',
      color: null,
      newline: true,
      level,
      list: tag === 'li',
    });
  });

  const css = h.inlineCss();
  const ff = css.matchAll(/font-family\s*:\s*([^;{}]+)/gi);
  for (const m of ff) {
    out.fonts.push(m[1].split(',')[0].trim().replace(/^["']|["']$/g, ''));
  }
  const hexes = css.matchAll(/#([0-9a-f]{6})\b/gi);
  for (const m of hexes) {
    const key = '#' + m[1].toLowerCase();
    out.colors[key] = (out.colors[key] ?? 0) + 1;
  }
  if (!runs.length) {
    out.error = 'The page has no readable body text.';
    return out;
  }
  return fromRuns(out, runs);
}

function readPlain(bytes: string, ext: string): DocTextResult {
  const out = blank();
  const text = bytes; // already utf8-ish
  if (!text.trim()) {
    out.error = 'The file has no readable text.';
    return out;
  }
  out.ok = true;
  const runs: DocRun[] = [];
  for (const lineRaw of text.split(/\r\n|\r|\n/)) {
    let line = lineRaw.replace(/\s+$/, '');
    if (line.trim() === '') continue;
    let level = 0;
    let list = false;
    if (ext === 'md' || ext === 'markdown') {
      const hm = line.match(/^(#{1,4})\s+(.*)$/);
      if (hm) {
        level = hm[1].length;
        line = hm[2];
      } else {
        const lm = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
        if (lm) {
          list = true;
          line = lm[2];
        }
      }
    } else {
      const lm = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/u);
      if (lm) {
        list = true;
        line = lm[2];
      }
    }
    runs.push({
      text: line.trim(),
      size: 0,
      font: '',
      color: null,
      newline: true,
      level,
      list,
    });
  }
  return fromRuns(out, runs);
}

export async function read(
  bytes: Buffer | string,
  filename = '',
  contentType = '',
): Promise<DocTextResult> {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  let out = blank();
  if (buf.length === 0) {
    out.error = 'The file is empty.';
    return out;
  }

  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  let kind = 'text';
  const head = buf.subarray(0, Math.min(200, buf.length)).toString('latin1');
  if (head.startsWith('%PDF-') || ext === 'pdf' || contentType.includes('pdf')) {
    kind = 'pdf';
  } else if (
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04 &&
    ['docx', 'pptx', ''].includes(ext)
  ) {
    kind = ext === 'pptx' ? 'pptx' : 'docx';
  } else if (
    ext === 'html' ||
    ext === 'htm' ||
    contentType.includes('html') ||
    /^\s*<(?:!doctype|html)/i.test(head)
  ) {
    kind = 'html';
  }

  switch (kind) {
    case 'pdf':
      out = await readPdf(buf);
      break;
    case 'docx':
    case 'pptx':
      out = await readOfficeZip(buf, kind);
      break;
    case 'html':
      out = readHtml(buf.toString('utf8'));
      break;
    default:
      out = readPlain(buf.toString('utf8'), ext);
  }

  out.kind = kind;
  out.bytes = buf.length;
  return finish(out);
}

const DocText = { read };
export default DocText;
