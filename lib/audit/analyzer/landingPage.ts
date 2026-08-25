import * as Rules from '@/lib/audit/rules';
import type { Finding, ProofItem } from '@/lib/audit/rules';

export type AnalyzerResult = {
  findings: Finding[];
  coverage: Record<string, string>;
  metrics: Record<string, unknown>;
};

/**
 * Landing-page audit — port of Analyzer/LandingPage.php.
 */
export function run(
  page: Record<string, unknown>,
  css: string,
  intake: Record<string, unknown>,
): AnalyzerResult {
  const findings: Finding[] = [];
  const coverage: Record<string, string> = {
    'value-prop': 'auto',
    cta: 'auto',
    ux: 'auto',
    speed: 'auto',
    mobile: 'auto',
    trust: 'auto',
  };

  const clientRendered = Boolean(page.client_rendered);
  if (clientRendered) {
    coverage['value-prop'] = 'manual';
    coverage.ux = 'manual';
    coverage.cta = 'manual';
  }

  const url = String(page.final_url);
  const proofUrl: ProofItem = { label: 'Page', value: shortUrl(url), url };

  const h1 = (page.h1 as string[]) ?? [];
  if (!clientRendered) {
    if (!h1.length) {
      findings.push(
        Rules.make(
          'lp-no-h1',
          'There is no H1 on the page, so nothing states the offer in one line.',
          {},
          [proofUrl],
        ),
      );
    } else if (h1.length > 1) {
      findings.push(
        Rules.make(
          'lp-multi-h1',
          `${h1.length} H1 headings compete: ${h1
            .slice(0, 3)
            .map((t) => `“${String(t).slice(0, 46)}”`)
            .join(' / ')}.`,
          { n: Rules.spell(h1.length) },
          [{ label: 'H1 count', value: String(h1.length) }],
        ),
      );
    }

    const headline = String(h1[0] ?? '').trim();
    if (headline !== '' && isVague(headline)) {
      findings.push(
        Rules.make(
          'lp-vague-headline',
          `The headline reads “${headline}” — no product, no audience and no outcome in it.`,
          {},
          [{ label: 'Headline', value: headline }],
        ),
      );
    }

    const title = String(page.title ?? '').trim();
    if (headline !== '' && title !== '' && overlap(headline, title) < 0.25) {
      findings.push(
        Rules.make(
          'lp-headline-title-mismatch',
          `The search title says “${title.slice(0, 60)}” while the page headline says “${headline.slice(0, 60)}”.`,
          {},
          [
            { label: 'Title', value: title },
            { label: 'Headline', value: headline },
          ],
        ),
      );
    }

    if (headline !== '' && !((page.paragraph_words as number[]) ?? []).length) {
      findings.push(
        Rules.make(
          'lp-no-subhead',
          'No supporting paragraph follows the headline anywhere on the page.',
          {},
          [proofUrl],
        ),
      );
    }
  }

  const og = (page.og as Record<string, string>) ?? {};
  if (String(page.description ?? '').trim() === '' || String(og.title ?? '').trim() === '') {
    const missing: string[] = [];
    if (String(page.description ?? '').trim() === '') missing.push('meta description');
    if (String(og.title ?? '').trim() === '') missing.push('og:title');
    if (String(og.image ?? '').trim() === '') missing.push('og:image');
    findings.push(
      Rules.make(
        'lp-meta-thin',
        `The page is missing its ${missing.join(' and ')}, so search and social render the preview from whatever they can scrape.`,
        {},
        missing.map((m) => ({ label: 'Missing', value: m })),
      ),
    );
  }

  const ctas = (page.ctas as Array<Record<string, unknown>>) ?? [];
  const strong = ctas.filter((c) => c.strong);
  const hero = strong.filter((c) => c.hero);
  const unique: Record<string, string> = {};
  for (const c of hero) {
    const key = String(c.text ?? '')
      .trim()
      .toLowerCase();
    let dupe = false;
    for (const seen of Object.keys(unique)) {
      if (seen.includes(key) || key.includes(seen)) {
        dupe = true;
        break;
      }
    }
    if (!dupe) unique[key] = String(c.text);
  }

  if (!clientRendered) {
    if (!hero.length && !strong.length) {
      findings.push(
        Rules.make(
          'lp-no-cta',
          `No button or link on the page asks for the conversion. The strongest actions found were ${
            ctas.length
              ? ctas
                  .slice(0, 3)
                  .map((c) => `“${c.text}”`)
                  .join(', ')
              : 'none at all'
          }.`,
          {},
          [proofUrl],
        ),
      );
    } else if (!hero.length && strong.length) {
      const depth = Math.round(
        Math.min(1, (Number(strong[0].order ?? 40) / Math.max(1, ctas.length + 20)) * 100),
      );
      findings.push(
        Rules.make(
          'lp-cta-below-fold',
          `The first conversion action, “${strong[0].text}”, only appears after the first section heading.`,
          { depth: String(Math.max(35, depth)) },
          [{ label: 'First CTA', value: String(strong[0].text) }],
        ),
      );
    } else if (Object.keys(unique).length >= 3) {
      const labels = Object.values(unique).slice(0, 5);
      findings.push(
        Rules.make(
          'lp-cta-collision',
          `The top of the page offers ${labels.map((l) => `“${l}”`).join(', ')}. They sit in the same band, so the eye has to choose.`,
          { n: Rules.spell(Object.keys(unique).length) },
          [{ label: 'Competing actions', value: labels.join(' · '), url }],
        ),
      );
    }

    if (strong.length === 1 && Number(page.text_len) > 4000) {
      findings.push(
        Rules.make(
          'lp-cta-not-repeated',
          `The page runs ${Number(page.text_len).toLocaleString('en-US')} characters with a single conversion action on it.`,
          {},
          [
            {
              label: 'Page length',
              value: `${Number(page.text_len).toLocaleString('en-US')} characters`,
            },
          ],
        ),
      );
    }

    for (const c of ctas) {
      if (/^(submit|click here|learn more|know more|read more|continue)$/i.test(String(c.text).trim())) {
        findings.push(
          Rules.make(
            'lp-cta-vague',
            `A primary-looking control is labelled “${c.text}”, which names no outcome.`,
            { label: String(c.text) },
            [{ label: 'Label', value: String(c.text) }],
          ),
        );
        break;
      }
    }
  }

  const contrast = ctaContrast(String(page.cta_classes ?? ''), css);
  if (contrast !== null && contrast.ratio < 4.5) {
    findings.push(
      Rules.make(
        'lp-cta-low-contrast',
        `The primary button renders ${contrast.fg} on ${contrast.bg} — a contrast ratio of ${contrast.ratio.toFixed(1)}:1, below the 4.5:1 minimum.`,
        { ratio: contrast.ratio.toFixed(1) },
        [
          { label: 'Text', value: contrast.fg },
          { label: 'Background', value: contrast.bg },
          { label: 'Ratio', value: `${contrast.ratio.toFixed(1)}:1` },
        ],
      ),
    );
  }

  if (!clientRendered) {
    const navLinks = Number(page.nav_link_count ?? 0);
    if (navLinks > 18) {
      findings.push(
        Rules.make(
          'lp-nav-overload',
          `${navLinks} links sit in the header and navigation of a page whose job is one conversion.`,
          { n: String(navLinks) },
          [{ label: 'Header/nav links', value: String(navLinks) }],
        ),
      );
    }

    if (Number(page.h2_count ?? 0) === 0 && Number(page.text_len) > 1500) {
      findings.push(
        Rules.make(
          'lp-heading-gaps',
          `The page carries ${Number(page.text_len).toLocaleString('en-US')} characters and not one H2 to break it up.`,
          {},
          [{ label: 'H2 count', value: '0' }],
        ),
      );
    }

    const paras = (page.paragraph_words as number[]) ?? [];
    if (paras.length) {
      const longest = Math.max(...paras);
      const avg = paras.reduce((a, b) => a + b, 0) / paras.length;
      if (longest > 120 || avg > 70) {
        findings.push(
          Rules.make(
            'lp-wall-of-text',
            `The longest paragraph runs ${longest} words and the average is ${Math.round(avg)}.`,
            { words: String(longest) },
            [
              { label: 'Longest paragraph', value: `${longest} words` },
              { label: 'Average', value: `${Math.round(avg)} words` },
            ],
          ),
        );
      }
    }

    const words = Math.max(1, Math.round(Number(page.text_len) / 5.5));
    const links = Math.max(1, Number(page.link_count));
    const ratio = Math.round(words / links);
    if (ratio > 0 && ratio < 12 && links > 25) {
      findings.push(
        Rules.make(
          'lp-link-density',
          `${links} links against roughly ${words.toLocaleString('en-US')} words of copy.`,
          { ratio: String(ratio) },
          [
            { label: 'Links', value: String(links) },
            { label: 'Words', value: words.toLocaleString('en-US') },
          ],
        ),
      );
    }
  }

  let maxFields = 0;
  for (const f of (page.forms as Array<{ fields: number }>) ?? []) {
    maxFields = Math.max(maxFields, Number(f.fields));
  }
  if (maxFields > 6) {
    findings.push(
      Rules.make(
        'lp-form-friction',
        `The longest form on the page asks for ${maxFields} fields before the visitor gets anything back.`,
        { fields: String(maxFields) },
        [{ label: 'Fields', value: String(maxFields) }],
      ),
    );
  }

  const ttfb = Number(page.ttfb);
  if (ttfb >= 0.8) {
    findings.push(
      Rules.make(
        'lp-slow-ttfb',
        `The page took ${ttfb.toFixed(2)}s to return its first byte, measured from this server.`,
        { ttfb: ttfb.toFixed(2) },
        [
          { label: 'TTFB', value: `${ttfb.toFixed(2)}s` },
          proofUrl,
        ],
        ttfb >= 1.5 ? 'high' : 'medium',
      ),
    );
  }

  const htmlBytes = Number(page.bytes);
  if (htmlBytes > 500000) {
    findings.push(
      Rules.make(
        'lp-heavy-html',
        `The page transfers ${bytes(htmlBytes)} of HTML before any image or script is counted.`,
        { weight: bytes(htmlBytes) },
        [{ label: 'HTML transferred', value: bytes(htmlBytes) }],
        htmlBytes > 1200000 ? 'high' : 'medium',
      ),
    );
  }

  const assets =
    Number(page.image_count) + Number(page.scripts) + ((page.stylesheets as string[]) ?? []).length;
  if (assets > 60) {
    findings.push(
      Rules.make(
        'lp-many-requests',
        `${assets} assets are referenced: ${Number(page.image_count)} images, ${Number(page.scripts)} scripts and ${((page.stylesheets as string[]) ?? []).length} stylesheets.`,
        { n: String(assets) },
        [
          { label: 'Images', value: String(Number(page.image_count)) },
          { label: 'Scripts', value: String(Number(page.scripts)) },
          {
            label: 'Stylesheets',
            value: String(((page.stylesheets as string[]) ?? []).length),
          },
        ],
      ),
    );
  }

  const blocking = Number(page.scripts_blocking ?? 0);
  if (blocking > 2) {
    findings.push(
      Rules.make(
        'lp-blocking-scripts',
        `${blocking} scripts load in the head with neither async nor defer, so the browser waits for each one.`,
        { n: String(blocking) },
        [{ label: 'Blocking scripts', value: String(blocking) }],
      ),
    );
  }

  const images = Number(page.image_count);
  const lazy = Number(page.images_lazy ?? 0);
  if (images >= 12 && lazy === 0) {
    findings.push(
      Rules.make(
        'lp-no-lazyload',
        `All ${images} images load immediately — not one uses loading="lazy".`,
        { n: String(images) },
        [
          { label: 'Images', value: String(images) },
          { label: 'Lazy-loaded', value: '0' },
        ],
      ),
    );
  }

  if (!page.viewport) {
    findings.push(
      Rules.make(
        'lp-no-viewport',
        'No <meta name="viewport"> tag, so phones render the desktop layout scaled down.',
        {},
        [proofUrl],
      ),
    );
  }

  const mediaQueries = (css.match(/@media[^{]*\(\s*(?:min|max)-width/gi) ?? []).length;
  if (css !== '' && mediaQueries === 0) {
    findings.push(
      Rules.make(
        'lp-no-media-queries',
        `None of the ${css.length.toLocaleString('en-US')} characters of CSS read contains a width-based media query.`,
        {},
        [{ label: 'CSS read', value: `${css.length.toLocaleString('en-US')} characters` }],
      ),
    );
  }

  const fixedMatches = [...css.matchAll(/(?:^|[;{])\s*(?:min-)?width\s*:\s*(\d{3,4})px/gi)];
  let wide = 0;
  for (const m of fixedMatches) {
    if (Number.parseInt(m[1], 10) >= 480) wide++;
  }
  if (wide > 4) {
    findings.push(
      Rules.make(
        'lp-fixed-widths',
        `${wide} CSS rules set a fixed width of 480px or more, which cannot shrink to a phone.`,
        { n: String(wide) },
        [{ label: 'Fixed-width rules', value: String(wide) }],
      ),
    );
  }

  const bodySize = bodyFontSize(css);
  if (bodySize !== null && bodySize < 16) {
    findings.push(
      Rules.make(
        'lp-small-type',
        `Body copy is set at ${bodySize}px, under the 16px that keeps phones from zooming.`,
        { size: `${bodySize}px` },
        [{ label: 'Body font size', value: `${bodySize}px` }],
      ),
    );
  }

  if (!page.https) {
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep */
    }
    findings.push(
      Rules.make('lp-not-https', `The page answered over plain HTTP at ${host}.`, {}, [proofUrl]),
    );
  } else if (Number(page.mixed ?? 0) > 0) {
    const n = Number(page.mixed);
    findings.push(
      Rules.make(
        'lp-mixed-content',
        `${n} subresource${n === 1 ? '' : 's'} on an https page ${n === 1 ? 'is' : 'are'} still requested over http://.`,
        { n: String(n) },
        [{ label: 'Insecure subresources', value: String(n) }],
      ),
    );
  }

  const trust = (page.trust as Record<string, number>) ?? {};
  const testimonials = (page.testimonials as Record<string, unknown>) ?? {};
  const contact = (page.contact as Record<string, unknown>) ?? {};
  const hasProof =
    Object.keys(trust).length > 0 ||
    Boolean(testimonials.found) ||
    Number(page.policy_links ?? 0) > 0;

  if (!hasProof) {
    findings.push(
      Rules.make(
        'lp-no-trust-markers',
        'No regulator, registration number, review, testimonial, rating or policy link appears anywhere on the page.',
        {},
        [proofUrl],
      ),
    );
  } else {
    if (Object.keys(trust).length) {
      const first = Math.min(...Object.values(trust));
      const key = Object.keys(trust).find((k) => trust[k] === first) ?? '';
      if (first > 0.55) {
        findings.push(
          Rules.make(
            'lp-trust-buried',
            `The first regulatory marker ("${key}") appears ${Math.round(first * 100)}% of the way down the page.`,
            { depth: String(Math.round(first * 100)) },
            [
              {
                label: 'First marker',
                value: `${key} at ${Math.round(first * 100)}% depth`,
              },
            ],
          ),
        );
      }
    }
    if (!testimonials.found) {
      findings.push(
        Rules.make(
          'lp-no-testimonials',
          'No testimonial, review count, rating or customer quote was found on the page.',
          {},
          [proofUrl],
        ),
      );
    }
  }

  if (
    String(contact.tel ?? '') === '' &&
    String(contact.email ?? '') === '' &&
    !contact.address
  ) {
    findings.push(
      Rules.make(
        'lp-no-contact',
        'No phone number, email address or postal address appears on the page.',
        {},
        [proofUrl],
      ),
    );
  }

  return {
    findings,
    coverage,
    metrics: {
      url,
      ttfb: Math.round(ttfb * 1000) / 1000,
      html_bytes: htmlBytes,
      assets,
      hero_ctas: Object.keys(unique).length,
      nav_links: Number(page.nav_link_count ?? 0),
      body_font_size: bodySize,
      media_queries: mediaQueries,
      contrast,
      trust_signals: Object.keys(trust),
      testimonials,
      contact,
      client_rendered: clientRendered,
      goal: String(intake.goal ?? ''),
      source: String(intake.source ?? ''),
    },
  };
}

function isVague(headline: string): boolean {
  const t = headline.trim().toLowerCase();
  if ([...t].length < 12) return true;
  const empty = [
    'welcome',
    'home',
    'our services',
    'about us',
    'we are',
    'your partner',
    'trusted partner',
    'the future of',
    'empowering',
    'one stop',
    'best in class',
    'world class',
    'leading provider',
    'solutions for',
  ];
  for (const phrase of empty) {
    if (t.includes(phrase) && [...t].length < 60) return true;
  }
  return !/\d/.test(t) && t.split(/\s+/u).filter(Boolean).length <= 3;
}

function overlap(a: string, b: string): number {
  const wa = a
    .toLowerCase()
    .split(/\W+/u)
    .filter((w) => [...w].length > 3);
  const wb = b
    .toLowerCase()
    .split(/\W+/u)
    .filter((w) => [...w].length > 3);
  if (!wa.length || !wb.length) return 1.0;
  const inter = wa.filter((w) => wb.includes(w)).length;
  return inter / Math.min(wa.length, wb.length);
}

function ctaContrast(
  classes: string,
  css: string,
): { fg: string; bg: string; ratio: number } | null {
  classes = classes.trim();
  if (classes === '' || css === '') return null;
  let fg: [number, number, number] | null = null;
  let bg: [number, number, number] | null = null;
  for (const cls of classes.split(/\s+/)) {
    if (cls === '' || !/^[A-Za-z][\w-]{1,40}$/.test(cls)) continue;
    const pattern = new RegExp(
      '\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:[,:][^{]*)?\\{([^}]{0,700})\\}',
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(css)) !== null) {
      const block = m[1];
      if (!bg) {
        const bm = block.match(/background(?:-color)?\s*:\s*([^;]+)/i);
        if (bm) bg = colorToRgb(bm[1]) ?? bg;
      }
      if (!fg) {
        const fm = block.match(/(?<!-)color\s*:\s*([^;]+)/i);
        if (fm) fg = colorToRgb(fm[1]) ?? fg;
      }
    }
  }
  if (!fg || !bg) return null;
  return { fg: rgbToHex(fg), bg: rgbToHex(bg), ratio: contrastRatio(fg, bg) };
}

function colorToRgb(value: string): [number, number, number] | null {
  value = value.trim().toLowerCase();
  const hex = value.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = value.match(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  const named: Record<string, [number, number, number] | null> = {
    white: [255, 255, 255],
    black: [0, 0, 0],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    transparent: null,
  };
  for (const [name, rgbVal] of Object.entries(named)) {
    if (value.startsWith(name)) return rgbVal;
  }
  return null;
}

function rgbToHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lum = (rgb: [number, number, number]): number => {
    const c = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const la = lum(a);
  const lb = lum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function bodyFontSize(css: string): number | null {
  const m = css.match(/(?:^|[},])\s*(?:html\s*,?\s*)?body[^{]{0,40}\{([^}]{0,900})\}/i);
  if (m) {
    const f = m[1].match(/font-size\s*:\s*([\d.]+)(px|rem|em|%)/i);
    if (f) {
      const n = Number.parseFloat(f[1]);
      const unit = f[2].toLowerCase();
      if (unit === 'px') return Math.round(n);
      if (unit === 'rem' || unit === 'em') return Math.round(n * 16);
      if (unit === '%') return Math.round((n / 100) * 16);
    }
  }
  return null;
}

export function bytes(n: number): string {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '') || url;
}

const LandingPage = { run, contrastRatio, bytes, shortUrl };
export default LandingPage;
