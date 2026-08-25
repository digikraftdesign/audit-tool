import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { createHash } from 'crypto';
import { resolveRelative } from '@/lib/http/urlGuard';

export interface HtmlLink {
  url: string;
  text: string;
  rel: string;
  nofollow: boolean;
}

export interface HtmlImage {
  src: string;
  alt: string;
  width: string;
  height: string;
  loading: string;
}

export interface HtmlForm {
  action: string;
  method: string;
  fields: number;
  required: number;
  labels: number;
  types: string[];
}

export interface HtmlCta {
  text: string;
  href: string;
  tag: string;
  order: number;
  hero: boolean;
  strong: boolean;
}

/**
 * Thin DOM helper around a fetched page (cheerio port of Support/Html.php).
 */
export class Html {
  url: string;
  raw: string;
  private $: cheerio.CheerioAPI | null = null;

  constructor(url: string, html: string) {
    this.url = url;
    this.raw = html;
    if (html.trim() === '') return;
    try {
      this.$ = cheerio.load(html, { xml: false });
    } catch {
      this.$ = null;
    }
  }

  ok(): boolean {
    return this.$ !== null;
  }

  query(selector: string): cheerio.Cheerio<Element>[] {
    if (!this.$) return [];
    const out: cheerio.Cheerio<Element>[] = [];
    this.$(selector).each((_, el) => {
      out.push(this.$!(el) as cheerio.Cheerio<Element>);
    });
    return out;
  }

  first(selector: string): cheerio.Cheerio<Element> | null {
    const all = this.query(selector);
    return all[0] ?? null;
  }

  static text(node: cheerio.Cheerio<AnyNode> | null | undefined): string {
    if (!node || node.length === 0) return '';
    const text = (node.text() ?? '').replace(/\s+/gu, ' ');
    return text.trim();
  }

  title(): string {
    return Html.text(this.first('title'));
  }

  meta(name: string): string {
    const n = name.toLowerCase();
    for (const m of this.query('meta[name]')) {
      if ((m.attr('name') ?? '').toLowerCase() === n) {
        return (m.attr('content') ?? '').trim();
      }
    }
    return '';
  }

  og(property: string): string {
    const p = property.toLowerCase();
    for (const m of this.query('meta[property]')) {
      if ((m.attr('property') ?? '').toLowerCase() === p) {
        return (m.attr('content') ?? '').trim();
      }
    }
    for (const m of this.query('meta[name]')) {
      if ((m.attr('name') ?? '').toLowerCase() === p) {
        return (m.attr('content') ?? '').trim();
      }
    }
    return '';
  }

  canonical(): string {
    for (const l of this.query('link[rel]')) {
      if ((l.attr('rel') ?? '').toLowerCase() === 'canonical') {
        return (l.attr('href') ?? '').trim();
      }
    }
    return '';
  }

  hasViewportMeta(): boolean {
    return this.meta('viewport') !== '';
  }

  headings(level: number): string[] {
    const out: string[] = [];
    for (const h of this.query(`h${level}`)) {
      const t = Html.text(h);
      if (t !== '') out.push(t);
    }
    return out;
  }

  links(): HtmlLink[] {
    const out: HtmlLink[] = [];
    for (const a of this.query('a[href]')) {
      const abs = resolveRelative(this.url, a.attr('href') ?? '');
      if (abs === null) continue;
      const rel = (a.attr('rel') ?? '').toLowerCase();
      out.push({
        url: abs,
        text: Html.text(a),
        rel,
        nofollow: rel.includes('nofollow'),
      });
    }
    return out;
  }

  images(): HtmlImage[] {
    const out: HtmlImage[] = [];
    for (const img of this.query('img')) {
      let src = img.attr('src') ?? '';
      if (src === '') src = img.attr('data-src') ?? '';
      if (src === '' || src.startsWith('data:')) continue;
      const abs = resolveRelative(this.url, src);
      if (abs === null) continue;
      out.push({
        src: abs,
        alt: (img.attr('alt') ?? '').trim(),
        width: img.attr('width') ?? '',
        height: img.attr('height') ?? '',
        loading: (img.attr('loading') ?? '').toLowerCase(),
      });
    }
    return out;
  }

  stylesheets(): string[] {
    const out: string[] = [];
    for (const l of this.query('link[rel]')) {
      if (!(l.attr('rel') ?? '').toLowerCase().includes('stylesheet')) continue;
      const abs = resolveRelative(this.url, l.attr('href') ?? '');
      if (abs !== null) out.push(abs);
    }
    return [...new Set(out)];
  }

  inlineCss(): string {
    let css = '';
    for (const s of this.query('style')) {
      css += '\n' + (s.html() ?? s.text() ?? '');
    }
    if (this.$) {
      this.$('[style]').each((_, el) => {
        css += '\n' + (this.$!(el).attr('style') ?? '');
      });
    }
    return css;
  }

  icons(): string[] {
    const out: string[] = [];
    for (const l of this.query('link[rel]')) {
      const rel = (l.attr('rel') ?? '').toLowerCase();
      if (!rel.includes('icon')) continue;
      const abs = resolveRelative(this.url, l.attr('href') ?? '');
      if (abs !== null) out.push(abs);
    }
    return [...new Set(out)];
  }

  jsonLd(): unknown[] {
    const out: unknown[] = [];
    for (const s of this.query('script[type]')) {
      if ((s.attr('type') ?? '').toLowerCase() !== 'application/ld+json') continue;
      try {
        const data = JSON.parse((s.html() ?? s.text() ?? '').trim());
        if (data && typeof data === 'object') out.push(data);
      } catch {
        // skip
      }
    }
    return out;
  }

  forms(): HtmlForm[] {
    const out: HtmlForm[] = [];
    if (!this.$) return out;
    this.$('form').each((_, formEl) => {
      const f = this.$!(formEl);
      let fields = 0;
      let required = 0;
      const types: string[] = [];
      f.find('input').each((__, inp) => {
        const type = ((this.$!(inp).attr('type') || 'text') as string).toLowerCase();
        if (['hidden', 'submit', 'button', 'image'].includes(type)) return;
        fields++;
        types.push(type);
        if (this.$!(inp).attr('required') !== undefined) required++;
      });
      for (const tag of ['select', 'textarea'] as const) {
        f.find(tag).each((__, el) => {
          fields++;
          types.push(tag);
          if (this.$!(el).attr('required') !== undefined) required++;
        });
      }
      out.push({
        action: (f.attr('action') ?? '').trim(),
        method: ((f.attr('method') || 'get') as string).toLowerCase(),
        fields,
        required,
        labels: f.find('label').length,
        types: [...new Set(types)],
      });
    });
    return out;
  }

  ctas(): HtmlCta[] {
    const out: HtmlCta[] = [];
    let order = 0;
    if (!this.$) return out;

    const nodes = this.$('a[href], button, input[type="submit"]').toArray();
    for (const el of nodes) {
      const $el = this.$(el);
      const tag = (el as Element).tagName?.toLowerCase() ?? '';
      let text =
        tag === 'input' ? ($el.attr('value') ?? '').trim() : Html.text($el);
      text = text.replace(/\s+/gu, ' ').trim();
      order++;
      if (text === '' || [...text].length > 42) continue;
      const kind = Html.ctaKind(text);
      if (kind === '') continue;
      if (Html.inChrome($el)) continue;
      const href =
        tag === 'a' ? String(resolveRelative(this.url, $el.attr('href') ?? '') ?? '') : '';
      out.push({
        text,
        href,
        tag,
        order,
        hero: this.aboveFirstSection($el),
        strong: kind === 'strong',
      });
    }
    return out;
  }

  private aboveFirstSection($el: cheerio.Cheerio<Element>): boolean {
    if (!this.$) return false;
    // Approximate: check if any h2/h3 appears before this element in document order
    const all = this.$('h2, h3, a[href], button, input[type="submit"]').toArray();
    const elNode = $el.get(0);
    let seenSection = false;
    for (const n of all) {
      if (n === elNode) return !seenSection;
      const tag = (n as Element).tagName?.toLowerCase() ?? '';
      if (tag === 'h2' || tag === 'h3') seenSection = true;
    }
    return !seenSection;
  }

  private static ctaKind(text: string): string {
    const t = text.toLowerCase().replace(/^[\s\t\n\r.!→›»]+|[\s\t\n\r.!→›»]+$/g, '');
    const strong = [
      'open an account', 'open account', 'open demat', 'open free', 'get started', 'start trading',
      'start investing', 'sign up', 'signup', 'register', 'create account', 'join now', 'apply now',
      'download app', 'download the app', 'get the app', 'book a demo', 'request a demo', 'talk to us',
      'contact sales', 'try free', 'start free', 'invest now', 'trade now', 'buy now', 'get a quote',
      'start now', 'claim', 'subscribe',
    ];
    for (const v of strong) {
      if (t.includes(v)) return 'strong';
    }
    const soft = ['know more', 'learn more', 'explore', 'discover', 'see how', 'find out', 'read more', 'view all'];
    for (const v of soft) {
      if (t.includes(v)) return 'soft';
    }
    return '';
  }

  private static inChrome($el: cheerio.Cheerio<Element>): boolean {
    let depth = 0;
    let cur: cheerio.Cheerio<AnyNode> = $el;
    while (depth < 12) {
      const parent = cur.parent();
      if (!parent || parent.length === 0) break;
      const name = (parent.get(0) as Element | undefined)?.tagName?.toLowerCase() ?? '';
      if (['nav', 'header', 'footer'].includes(name)) return true;
      const hint = `${parent.attr('class') ?? ''} ${parent.attr('id') ?? ''} ${parent.attr('role') ?? ''}`.toLowerCase();
      if (/\b(nav|navbar|navigation|header|topbar|footer|menu)\b/.test(hint)) return true;
      cur = parent;
      depth++;
    }
    return false;
  }

  visibleText(): string {
    if (!this.$) {
      return (this.raw.replace(/<[^>]+>/g, ' ').replace(/\s+/gu, ' ') || '').trim();
    }
    const clone = cheerio.load(this.$.html() ?? '');
    clone('script, style, noscript, template, svg').remove();
    const body = clone('body');
    return Html.text(body.length ? body : clone.root());
  }

  offsetOf(needle: string, haystack?: string): number {
    const hay = haystack ?? this.visibleText();
    const pos = hay.toLowerCase().indexOf(needle.toLowerCase());
    return pos === -1 ? -1 : pos;
  }

  chromeSignature(): string {
    const bits: string[] = [];
    for (const q of ['nav', 'header', 'footer']) {
      for (const el of this.query(q)) {
        bits.push(Html.text(el));
      }
    }
    const sig = bits.join(' | ').toLowerCase();
    return sig.replace(/\s+/gu, ' ').trim();
  }

  navLabels(): string[] {
    const labels: string[] = [];
    for (const a of this.query('nav a, header a')) {
      const t = Html.text(a);
      if (t !== '' && [...t].length <= 32) {
        labels.push(t.toLowerCase());
      }
    }
    return [...new Set(labels)];
  }

  logoCandidates(): string[] {
    const out: string[] = [];
    const home = this.homeHrefs();

    for (const img of this.query('header img, nav img')) {
      const src = img.attr('src') || img.attr('data-src') || '';
      const hay = `${src} ${img.attr('alt') ?? ''} ${img.attr('class') ?? ''} ${img.attr('id') ?? ''}`.toLowerCase();
      const named = hay.includes('logo') || hay.includes('brand') || hay.includes('wordmark');
      if (!named && !Html.insideHomeLink(img, home)) continue;
      if (Html.isNotABrandMark(hay)) continue;
      const abs = resolveRelative(this.url, src);
      if (abs !== null) out.push(abs);
    }

    for (const svg of this.query('header svg, nav svg')) {
      const hay = `${svg.attr('class') ?? ''} ${svg.attr('id') ?? ''} ${Html.text(svg)}`.toLowerCase();
      const named = hay.includes('logo') || hay.includes('brand');
      if (!named && !Html.insideHomeLink(svg, home)) continue;
      if (Html.isNotABrandMark(hay)) continue;
      const html = this.$ ? this.$.html(svg.get(0)!) ?? hay : hay;
      const hash = createHash('md5').update(html).digest('hex').slice(0, 10);
      out.push('inline-svg:' + hash);
    }
    return [...new Set(out)];
  }

  private homeHrefs(): string[] {
    try {
      const u = new URL(this.url);
      const origin = `${u.protocol}//${u.host}`;
      return ['/', origin, origin + '/', './', this.url];
    } catch {
      return ['/', './', this.url];
    }
  }

  private static insideHomeLink(
    node: cheerio.Cheerio<Element>,
    home: string[],
  ): boolean {
    let depth = 0;
    let cur: cheerio.Cheerio<AnyNode> = node;
    while (depth < 6) {
      const parent = cur.parent();
      if (!parent || parent.length === 0) break;
      const name = (parent.get(0) as Element | undefined)?.tagName?.toLowerCase() ?? '';
      if (name === 'a') {
        const href = (parent.attr('href') ?? '').trim().replace(/\/$/, '');
        for (const candidate of home) {
          if (href !== '' && href === candidate.replace(/\/$/, '')) return true;
        }
        return false;
      }
      cur = parent;
      depth++;
    }
    return false;
  }

  private static isNotABrandMark(hay: string): boolean {
    return /(facebook|instagram|linkedin|twitter|x-logo|youtube|whatsapp|telegram|pinterest|tiktok|threads|app-?store|play-?store|google-?play|appstore|playstore|visa|mastercard|rupay|upi|paytm|razorpay|stripe|payment|partner|client|award|badge|certificate|sponsor|member|press|media-?logo)/.test(
      hay,
    );
  }

  /** Attribute helper used by crawler. */
  attr(selector: string, name: string): string {
    const el = this.first(selector);
    return el ? (el.attr(name) ?? '').trim() : '';
  }
}

export default Html;
