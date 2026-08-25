import { Html } from '@/lib/html';
import { Http, type HttpResult } from '@/lib/http/http';
import { sameSite } from '@/lib/http/urlGuard';

/**
 * Fetches pages and reduces each one to a small "fact sheet".
 */
export class Crawler {
  private http: Http;
  private maxPages: number;

  constructor(http: Http, maxPages = 8) {
    this.http = http;
    this.maxPages = Math.max(1, maxPages);
  }

  async fetchOne(url: string, role = 'home'): Promise<Record<string, unknown>> {
    const res = await this.http.get(url);
    return this.facts(res, role);
  }

  async fetchMany(
    urlToRole: Record<string, string>,
    deadline: number,
  ): Promise<Array<Record<string, unknown>>> {
    const responses = await this.http.getMany(Object.keys(urlToRole), deadline);
    const out: Array<Record<string, unknown>> = [];
    for (const [url, res] of Object.entries(responses)) {
      out.push(this.facts(res, urlToRole[url] ?? 'page'));
    }
    return out;
  }

  discover(home: Record<string, unknown>): Record<string, string> {
    const base = String(home.final_url ?? home.url);
    const buckets: Record<string, RegExp> = {
      campaign:
        /(f-?and-?o|f&o|futures|options|derivative|intraday|commodit|currency|ipo|margin|mutual-?fund|sip|equity|trading-?account)/i,
      conversion:
        /(open-?an?-?account|open-?account|account-?open|sign-?up|signup|register|onboard|kyc|demat|get-?started|apply)/i,
      trust:
        /(about|why-?us|trust|regulat|compliance|investor|grievance|disclosure|policies|security|safety)/i,
      pricing: /(pricing|charges|brokerage|fees|plans|cost)/i,
      app: /(app|download|mobile)/i,
      contact: /(contact|support|help)/i,
    };

    const seen: Record<string, boolean> = {
      [base.toLowerCase().replace(/\/$/, '')]: true,
    };

    const candidates: Record<string, Record<string, boolean>> = {};
    for (const [role, pattern] of Object.entries(buckets)) {
      candidates[role] = {};
      for (const link of (home.links as Array<Record<string, unknown>>) ?? []) {
        let url = String(link.url ?? '');
        if (url === '' || !sameSite(base, url)) continue;
        url = url.split('#')[0];
        if (!url) continue;
        const key = url.toLowerCase().replace(/\/$/, '');
        if (seen[key] || candidates[role][url]) continue;
        let path = '';
        try {
          path = new URL(url).pathname;
        } catch {
          continue;
        }
        const hay = path + ' ' + String(link.text ?? '');
        if (!pattern.test(hay)) continue;
        if (/\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|ppt|pptx|mp4)$/i.test(path)) continue;
        if (
          role === 'campaign' &&
          /(calculator|calc|tool|glossary|blog|news|varsity|faq|chart)/i.test(path)
        ) {
          continue;
        }
        candidates[role][url] = true;
      }
    }

    const picked: Record<string, string> = {};
    const budget = this.maxPages - 1;
    for (let round = 0; round < 4 && Object.keys(picked).length < budget; round++) {
      for (const role of Object.keys(buckets)) {
        if (Object.keys(picked).length >= budget) break;
        for (const url of Object.keys(candidates[role])) {
          const key = url.toLowerCase().replace(/\/$/, '');
          delete candidates[role][url];
          if (seen[key]) continue;
          seen[key] = true;
          picked[url] = role;
          break;
        }
      }
    }

    return picked;
  }

  private facts(res: HttpResult, role: string): Record<string, unknown> {
    const url = String(res.final_url || res.url);
    const facts: Record<string, unknown> = {
      role,
      url: String(res.url),
      final_url: url,
      status: Number(res.status),
      ok: Boolean(res.ok),
      error: String(res.error),
      ttfb: Number(res.ttfb),
      total: Number(res.total),
      bytes: Number(res.bytes),
      content_type: String(res.content_type),
      https: url.startsWith('https://'),
    };

    const body = String(res.body ?? '');
    const ct = String(facts.content_type);
    if (!facts.ok || body === '' || (!ct.includes('html') && ct !== '')) {
      return { ...facts, ...this.emptyFacts() };
    }

    const h = new Html(url, body);
    if (!h.ok()) {
      return { ...facts, ...this.emptyFacts() };
    }

    const text = h.visibleText();
    const textLen = Math.max(1, [...text].length);
    const links = h.links();
    const images = h.images();
    let noAlt = 0;
    for (const img of images) {
      if (img.alt === '') noAlt++;
    }

    const lang = h.attr('html', 'lang');

    Object.assign(facts, {
      title: h.title(),
      description: h.meta('description'),
      canonical: h.canonical(),
      viewport: h.hasViewportMeta(),
      lang,
      og: {
        title: h.og('og:title'),
        image: h.og('og:image'),
        site_name: h.og('og:site_name'),
        desc: h.og('og:description'),
      },
      twitter_card: h.og('twitter:card'),
      h1: h.headings(1),
      h2_count: h.headings(2).length,
      links: links.slice(0, 400),
      link_count: links.length,
      image_count: images.length,
      image_no_alt: noAlt,
      image_srcs: images.map((i) => i.src).slice(0, 60),
      stylesheets: h.stylesheets(),
      icons: h.icons(),
      inline_css: h.inlineCss().slice(0, 120000),
      forms: h.forms(),
      ctas: h.ctas(),
      nav_labels: h.navLabels(),
      chrome_sig: h.chromeSignature(),
      logos: h.logoCandidates(),
      text_len: textLen,
      text: text.slice(0, 240000),
      scripts: h.query('script').length,
      client_rendered: textLen < 1200 && h.query('script').length >= 4,
      scripts_blocking: h.query(
        'head script[src]:not([async]):not([defer]):not([type="module"])',
      ).length,
      images_lazy: h.query('img[loading="lazy"]').length,
      nav_link_count: h.query('nav a, header a').length,
      list_items: h.query('li').length,
      paragraph_words: Crawler.paragraphWords(h),
      testimonials: Crawler.testimonials(h, text),
      contact: Crawler.contact(h, text),
      policy_links: Crawler.policyLinks(links),
      cta_classes: Crawler.ctaClasses(h),
      jsonld: this.jsonLdSummary(h),
      trust: this.trustSignals(text, textLen),
      pdf_links: this.pdfLinks(links),
      social_links: this.socialLinks(links),
      mixed: facts.https ? this.mixedContent(body) : 0,
      declared_img_bytes: 0,
      headline: h.headings(1)[0] ?? '',
    });

    return facts;
  }

  private static paragraphWords(h: Html): number[] {
    const out: number[] = [];
    for (const p of h.query('p')) {
      const text = Html.text(p);
      if (text === '') continue;
      const n = text.split(/\s+/u).filter(Boolean).length;
      if (n >= 4) out.push(n);
    }
    return out.slice(0, 200);
  }

  private static testimonials(
    h: Html,
    text: string,
  ): { found: boolean; quote: string; signals: string[] } {
    const signals: string[] = [];

    for (const el of h.query('blockquote, [itemprop="review"], [itemtype]')) {
      const type = `${el.attr('itemtype') ?? ''} ${el.attr('itemprop') ?? ''}`.toLowerCase();
      const tag = (el.get(0) as { tagName?: string } | undefined)?.tagName?.toLowerCase() ?? '';
      if (tag === 'blockquote' || type.includes('review') || type.includes('rating')) {
        signals.push('marked-up quote');
        break;
      }
    }
    for (const el of h.query('[class]')) {
      const cls = (el.attr('class') ?? '').toLowerCase();
      if (/\b(testimonial|review|rating|trustpilot|customer-say|client-say)/.test(cls)) {
        signals.push('testimonial block');
        break;
      }
    }
    const countM = text.match(
      /\b(\d[\d,.]*)\+?\s*(reviews?|ratings?|customers?|users?|clients?|investors?|traders?)\b/i,
    );
    if (countM) signals.push('social proof count: ' + countM[0].trim());
    if (/[“"][^”"]{40,240}[”"]\s*[—–-]\s*[A-Z]/u.test(text)) {
      signals.push('attributed quote');
    }

    let quote = '';
    const qm = text.match(/[“"]([^”"]{40,200})[”"]/u);
    if (qm) quote = qm[1].trim();

    return { found: signals.length > 0, quote, signals: [...new Set(signals)] };
  }

  private static contact(
    h: Html,
    text: string,
  ): { tel: string; email: string; address: boolean } {
    let tel = '';
    let email = '';
    for (const a of h.query('a[href]')) {
      const href = (a.attr('href') ?? '').trim().toLowerCase();
      if (tel === '' && href.startsWith('tel:')) tel = href.slice(4);
      if (email === '' && href.startsWith('mailto:')) email = href.slice(7);
    }
    if (email === '') {
      const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (m) email = m[0];
    }
    if (tel === '') {
      const m = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}\b/);
      if (m) tel = m[0];
    }
    const address = /\b(registered office|corporate office|address|floor|tower|road|marg|sector)\b/i.test(
      text,
    );
    return { tel, email, address };
  }

  private static policyLinks(links: Array<{ url: string; text: string }>): number {
    let n = 0;
    for (const l of links) {
      if (/(privacy|terms|disclaimer|refund|grievance|cookie|policy|disclosure)/i.test(l.url + ' ' + l.text)) {
        n++;
      }
    }
    return n;
  }

  private static ctaClasses(h: Html): string {
    for (const el of h.query('a[href], button')) {
      const text = Html.text(el);
      if (text === '' || [...text].length > 42) continue;
      if (
        !/(open an? account|open account|get started|sign ?up|register|start (trading|investing|free|now)|download app|book a demo|apply now|invest now|create account)/i.test(
          text,
        )
      ) {
        continue;
      }
      const cls = (el.attr('class') ?? '').trim();
      if (cls !== '') return cls;
    }
    return '';
  }

  private emptyFacts(): Record<string, unknown> {
    return {
      title: '',
      description: '',
      canonical: '',
      viewport: false,
      lang: '',
      og: { title: '', image: '', site_name: '', desc: '' },
      twitter_card: '',
      h1: [],
      h2_count: 0,
      links: [],
      link_count: 0,
      image_count: 0,
      image_no_alt: 0,
      image_srcs: [],
      stylesheets: [],
      icons: [],
      inline_css: '',
      forms: [],
      ctas: [],
      nav_labels: [],
      chrome_sig: '',
      scripts: 0,
      client_rendered: false,
      text: '',
      scripts_blocking: 0,
      images_lazy: 0,
      nav_link_count: 0,
      list_items: 0,
      paragraph_words: [],
      testimonials: { found: false, quote: '', signals: [] },
      contact: { tel: '', email: '', address: false },
      policy_links: 0,
      cta_classes: '',
      logos: [],
      text_len: 0,
      jsonld: { types: [], org_names: [], has_logo: false },
      trust: {},
      pdf_links: {},
      social_links: {},
      mixed: 0,
      declared_img_bytes: 0,
      headline: '',
    };
  }

  private trustSignals(text: string, textLen: number): Record<string, number> {
    const terms: Record<string, RegExp> = {
      sebi: /\bsebi\b/i,
      exchange: /\b(nse|bse|mcx|ncdex)\b/i,
      registration: /\b(inz|inh|inp|arn|cin)[a-z0-9]{5,}/i,
      grievance: /\bgrievance|complaint|ombudsman\b/i,
      risk: /risk disclosur|market risk|subject to market/i,
      custody: /\b(cdsl|nsdl|depositor(y|ies)|custody)\b/i,
      regulated: /\b(regulated|licens|registered with|rbi|irdai)\b/i,
    };
    const out: Record<string, number> = {};
    for (const [key, pattern] of Object.entries(terms)) {
      const m = pattern.exec(text);
      if (m && m.index !== undefined) {
        const ratio = m.index / textLen;
        out[key] = Math.round(Math.min(1, ratio) * 1000) / 1000;
      }
    }
    return out;
  }

  private pdfLinks(links: Array<{ url: string; text: string }>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const l of links) {
      try {
        const path = new URL(l.url).pathname.toLowerCase();
        if (path.endsWith('.pdf')) out[l.url] = l.text.trim();
      } catch {
        // skip
      }
    }
    return out;
  }

  private socialLinks(
    links: Array<{ url: string; text: string }>,
  ): Record<string, string[]> {
    const networks: Record<string, RegExp> = {
      instagram: /^https?:\/\/(www\.)?instagram\.com\//i,
      facebook: /^https?:\/\/(www\.|m\.)?facebook\.com\//i,
      linkedin: /^https?:\/\/([a-z]{2}\.)?(www\.)?linkedin\.com\//i,
      youtube: /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i,
      x: /^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i,
      telegram: /^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i,
      whatsapp: /^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i,
      gbp: /^https?:\/\/(www\.)?(g\.page|maps\.app\.goo\.gl|goo\.gl\/maps|business\.google\.com)/i,
    };
    const out: Record<string, string[]> = {};
    for (const l of links) {
      for (const [net, pattern] of Object.entries(networks)) {
        if (pattern.test(l.url)) {
          if (!out[net]) out[net] = [];
          out[net].push(l.url);
        }
      }
    }
    for (const net of Object.keys(out)) {
      out[net] = [...new Set(out[net])];
    }
    return out;
  }

  private mixedContent(body: string): number {
    let n = 0;
    const a = body.match(/\bsrc\s*=\s*["']http:\/\/[^"']+/gi);
    if (a) n += a.length;
    const b = body.match(/<link\b[^>]*\bhref\s*=\s*["']http:\/\/[^"']+/gi);
    if (b) n += b.length;
    const c = body.match(/\b(?:srcset|data-src|poster)\s*=\s*["']http:\/\/[^"']+/gi);
    if (c) n += c.length;
    return n;
  }

  private jsonLdSummary(h: Html): {
    types: string[];
    org_names: string[];
    has_logo: boolean;
  } {
    const types: string[] = [];
    const names: string[] = [];
    let logo = false;

    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj['@type']) {
        for (const t of Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']]) {
          if (typeof t === 'string') {
            types.push(t);
            if (
              ['organization', 'corporation', 'financialservice', 'localbusiness', 'brand'].includes(
                t.toLowerCase(),
              )
            ) {
              if (typeof obj.name === 'string' && obj.name) names.push(obj.name.trim());
              if (obj.logo) logo = true;
            }
          }
        }
      }
      for (const child of Object.values(obj)) {
        if (Array.isArray(child)) child.forEach(walk);
        else if (child && typeof child === 'object') walk(child);
      }
    };
    for (const block of h.jsonLd()) walk(block);

    return {
      types: [...new Set(types)],
      org_names: [...new Set(names)],
      has_logo: logo,
    };
  }
}

export default Crawler;
