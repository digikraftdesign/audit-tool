import * as Rules from '@/lib/audit/rules';
import type { ProofItem } from '@/lib/audit/rules';
import type { AnalyzerResult } from '@/lib/audit/analyzer/landingPage';
import DocumentFile from '@/lib/audit/analyzer/documentFile';

/**
 * Branding audit — port of Analyzer/Branding.php.
 *
 * Reads the identity across every page it can see: the lockup, the type, the
 * palette, the tone of the copy, whether the stated audience is actually spoken
 * to, how much of it overlaps the named competitors, and whether there is a
 * mission anywhere. Audience and competitor checks depend on what the intake
 * supplied; without those inputs the parameter is handed to the consultant
 * rather than scored on a guess.
 */

/** Phrases every financial brand uses, which therefore differentiate none of them. */
const CLICHES = [
  'trusted partner',
  'your trusted',
  'one stop',
  'one-stop',
  'seamless experience',
  'cutting edge',
  'cutting-edge',
  'world class',
  'world-class',
  'best in class',
  'empowering',
  'unlock your',
  'take control of your',
  'wealth creation journey',
  'financial freedom',
  'grow your wealth',
  'invest smarter',
  'simple, safe',
  'customer centric',
  'customer-centric',
  'industry leading',
  'industry-leading',
  'state of the art',
  'end to end',
  'end-to-end',
  'hassle free',
  'hassle-free',
  'next generation',
  'next-gen',
  'redefining',
  'revolutionising',
  'revolutionizing',
];

function charLen(s: string): number {
  return [...s].length;
}

export function run(
  pages: Array<Record<string, unknown>>,
  css: string,
  extra: Record<string, unknown>,
  competitors: Array<Record<string, unknown>>,
  intake: Record<string, unknown>,
): AnalyzerResult {
  const findings: ReturnType<typeof Rules.make>[] = [];
  const coverage: Record<string, string> = {
    'visual-identity': 'auto',
    'brand-voice': 'auto',
    'audience-alignment': 'manual',
    uniqueness: 'auto',
    'core-values': 'auto',
  };

  const live = pages.filter((p) => Boolean(p.ok));
  if (!live.length) {
    return { findings: [], coverage, metrics: {} };
  }
  const home = live[0];
  const company = String(intake.company ?? '').trim();

  // ====================================================== visual identity
  const logos: Record<string, string> = {};
  for (const p of live) {
    for (const src of (p.logos as string[]) ?? []) {
      logos[assetKey(String(src))] = String(src);
    }
  }
  const logoList = Object.values(logos);
  if (logoList.length > 1) {
    findings.push(
      Rules.make(
        'br-multi-logo',
        `${logoList.length} distinct logo files are served across the pages read: ${logoList
          .slice(0, 4)
          .map((u) => shortAsset(u))
          .join(', ')}.`,
        { n: Rules.spell(logoList.length) },
        logoList.slice(0, 4).map(
          (u): ProofItem => ({ label: 'Logo asset', value: shortAsset(u), url: u }),
        ),
      ),
    );
  } else if (
    !logoList.length &&
    !((home.icons as unknown[]) ?? []).length &&
    String((home.og as Record<string, string>)?.image ?? '').trim() === ''
  ) {
    findings.push(
      Rules.make(
        'br-no-logo',
        'Nothing brand-shaped is declared: no image named as a logo in the masthead, no icon link and no share image.',
        {},
        [{ label: 'Pages checked', value: String(live.length) }],
      ),
    );
  }

  if (!((home.icons as unknown[]) ?? []).length && !extra.favicon_found) {
    findings.push(
      Rules.make(
        'br-no-favicon',
        'No icon link tag on the entry page and no /favicon.ico at the root.',
        {},
        [{ label: 'Checked', value: 'link[rel*=icon] and /favicon.ico' }],
      ),
    );
  }

  const noOg: string[] = [];
  for (const p of live) {
    if (String((p.og as Record<string, string>)?.image ?? '').trim() === '') {
      noOg.push(pagePath(p));
    }
  }
  if (noOg.length) {
    findings.push(
      Rules.make(
        'br-no-og-image',
        `${noOg.length} of ${live.length} pages declare no og:image, so shares and paid previews fall back to whatever the platform scrapes: ${noOg
          .slice(0, 4)
          .join(', ')}.`,
        { n: String(noOg.length) },
        noOg.slice(0, 4).map((p) => ({ label: 'No share image', value: p })),
      ),
    );
  }

  const families = fontFamilies(css, live);
  if (families.length > 3) {
    findings.push(
      Rules.make(
        'br-type-sprawl',
        `${families.length} type families are referenced in the CSS the site loads: ${families
          .slice(0, 6)
          .join(', ')}.`,
        { n: Rules.spell(families.length) },
        families.slice(0, 6).map((f) => ({ label: 'Family', value: f })),
      ),
    );
  }

  const pal = palette(css);
  if (pal.accents.length > 8) {
    findings.push(
      Rules.make(
        'br-palette-sprawl',
        `${pal.accents.length} saturated colours appear in the stylesheet: ${pal.accents
          .slice(0, 8)
          .join(' ')}.`,
        { n: String(pal.accents.length) },
        pal.accents.slice(0, 8).map((c) => ({ label: 'Colour', value: c })),
      ),
    );
  }
  if (pal.category_only && pal.accents.length >= 2) {
    findings.push(
      Rules.make(
        'br-category-colour',
        `The only saturated colours in the stylesheet sit in the market green / market red range (${pal.accents
          .slice(0, 6)
          .join(' ')}) — the ticker palette every competitor uses.`,
        {},
        pal.accents.slice(0, 6).map((c) => ({ label: 'Colour', value: c })),
      ),
    );
  }

  // =========================================================== brand voice
  const voice = voiceStats(live);
  if (voice.pages >= 3 && voice.sentence_cv > 0.45) {
    findings.push(
      Rules.make(
        'br-tone-drift',
        `Sentence length swings from ${Math.round(voice.min_sentence)} to ${Math.round(
          voice.max_sentence,
        )} words page to page — the pages do not read as one writer.`,
        {},
        [
          { label: 'Shortest average', value: `${Math.round(voice.min_sentence)} words` },
          { label: 'Longest average', value: `${Math.round(voice.max_sentence)} words` },
        ],
      ),
    );
  }

  const tag = tagline(live);
  if (tag === null) {
    findings.push(
      Rules.make(
        'br-no-tagline',
        'No line repeats across the pages read, in a title, an og:title or a headline. There is no sentence the brand owns.',
        {},
        [{ label: 'Pages compared', value: String(live.length) }],
      ),
    );
  }

  if (voice.jargon_rate > 0.02) {
    findings.push(
      Rules.make(
        'br-jargon-heavy',
        `${Math.round(voice.jargon_rate * 1000 * 10) / 10} category terms per thousand words, led by ${voice.jargon_top
          .slice(0, 4)
          .join(', ')}.`,
        {},
        voice.jargon_top.slice(0, 4).map((j) => ({ label: 'Term', value: j })),
      ),
    );
  }

  const variants = nameVariants(live, company);
  if (variants.length > 2) {
    findings.push(
      Rules.make(
        'br-name-drift',
        `The brand name appears as ${variants
          .slice(0, 4)
          .map((v) => `“${v}”`)
          .join(' / ')} across page titles, share data and structured data.`,
        { n: Rules.spell(variants.length) },
        variants.slice(0, 4).map((v) => ({ label: 'Spelling', value: v })),
      ),
    );
  }

  // ==================================================== audience alignment
  const audience = String(intake.audience ?? '').trim();
  if (audience !== '') {
    coverage['audience-alignment'] = 'auto';
    const terms = audienceTerms(audience);
    const body = live.map((p) => String(p.text ?? '')).join(' ').toLowerCase();

    const hits: string[] = [];
    const missed: string[] = [];
    for (const term of terms) {
      if (term === '') continue;
      if (body.includes(term)) hits.push(term);
      else missed.push(term);
    }
    if (terms.length && !hits.length) {
      findings.push(
        Rules.make(
          'br-audience-absent',
          `None of the words describing the target audience (${terms
            .slice(0, 5)
            .join(', ')}) appear anywhere in the copy read.`,
          {},
          missed.slice(0, 5).map((t) => ({ label: 'Never mentioned', value: t })),
        ),
      );
    } else if (terms.length && hits.length < Math.max(1, Math.ceil(terms.length / 2))) {
      findings.push(
        Rules.make(
          'br-audience-thin',
          `Only ${hits.length} of ${terms.length} audience themes appear in the copy: ${hits
            .slice(0, 4)
            .join(', ')}. Missing: ${missed.slice(0, 4).join(', ')}.`,
          { n: String(hits.length) },
          missed.slice(0, 4).map((t) => ({ label: 'Missing theme', value: t })),
        ),
      );
    }

    const grade = DocumentFile.readability(
      live
        .slice(0, 3)
        .map((p) => String(p.text ?? ''))
        .join(' '),
    );
    if (grade.grade > 13) {
      findings.push(
        Rules.make(
          'br-reading-mismatch',
          `The site copy reads at roughly grade ${grade.grade}, with sentences averaging ${grade.avg_sentence} words.`,
          { grade: String(grade.grade) },
          [
            { label: 'Reading grade', value: String(grade.grade) },
            { label: 'Average sentence', value: `${grade.avg_sentence} words` },
          ],
        ),
      );
    }
  }

  // ============================================================ uniqueness
  const headlineCopy = [
    ...live.map((p) => String(p.title ?? '')),
    ...live.map((p) => ((p.h1 as string[]) ?? []).join(' ')),
  ]
    .join(' ')
    .toLowerCase();
  const cliches: string[] = [];
  for (const phrase of CLICHES) {
    if (headlineCopy.includes(phrase)) cliches.push(phrase);
  }
  if (cliches.length) {
    findings.push(
      Rules.make(
        'br-cliche',
        `Headline copy leans on ${cliches
          .slice(0, 4)
          .map((c) => `“${c}”`)
          .join(', ')}.`,
        { n: String(cliches.length) },
        cliches.slice(0, 4).map((c) => ({ label: 'Cliché', value: c })),
      ),
    );
  }

  for (const rival of competitors) {
    const name = String(rival.host ?? 'the competitor');
    const rivalPalette = palette(String(rival.css ?? ''));
    const shared = intersect(
      pal.accents.map((c) => hueBucket(c)),
      rivalPalette.accents.map((c) => hueBucket(c)),
    );
    if (shared.length >= 2 && pal.accents.length && rivalPalette.accents.length) {
      findings.push(
        Rules.make(
          'br-palette-overlap',
          `The palette shares ${shared.length} hue families with ${name} (${pal.accents
            .slice(0, 3)
            .join(' ')} against ${rivalPalette.accents.slice(0, 3).join(' ')}).`,
          { competitor: name },
          [
            { label: 'This brand', value: pal.accents.slice(0, 4).join(' ') },
            { label: name, value: rivalPalette.accents.slice(0, 4).join(' ') },
          ],
        ),
      );
    }

    const rivalFonts = fontFamilies(String(rival.css ?? ''), []);
    const sharedType = intersect(
      families.map((f) => f.toLowerCase()),
      rivalFonts.map((f) => f.toLowerCase()),
    );
    if (sharedType.length && families.length) {
      findings.push(
        Rules.make(
          'br-type-overlap',
          `Both brands set type in ${sharedType.slice(0, 3).join(', ')}.`,
          { competitor: name },
          [{ label: 'Shared typefaces', value: sharedType.slice(0, 3).join(', ') }],
        ),
      );
    }

    const rivalHeadline = `${String(rival.headline ?? '')} ${String(rival.title ?? '')}`.toLowerCase();
    const ourHeadline = `${String(((home.h1 as string[]) ?? [])[0] ?? '')} ${String(home.title ?? '')}`.toLowerCase();
    if (rivalHeadline !== '' && ourHeadline !== '' && jaccard(ourHeadline, rivalHeadline) > 0.3) {
      findings.push(
        Rules.make(
          'br-message-overlap',
          `The headline claim overlaps ${name}: “${ourHeadline.trim().slice(0, 60)}” against “${rivalHeadline
            .trim()
            .slice(0, 60)}”.`,
          { competitor: name },
          [
            { label: 'This brand', value: ourHeadline.trim().slice(0, 70) },
            { label: name, value: rivalHeadline.trim().slice(0, 70) },
          ],
        ),
      );
    }
  }

  // =========================================================== core values
  const allText = live
    .map((p) => String(p.text ?? ''))
    .join(' ')
    .toLowerCase();
  const mission = findStatement(
    live,
    /\b(our mission|our purpose|why we exist|we believe|our vision|we are on a mission)\b/i,
  );
  const values = Boolean(
    /\b(our values|core values|what we stand for|our principles|guiding principles)\b/i.test(allText),
  );

  if (mission === null) {
    findings.push(
      Rules.make(
        'br-no-mission',
        `No mission, purpose or vision statement was found on any of the ${live.length} pages read.`,
        {},
        [{ label: 'Pages searched', value: String(live.length) }],
      ),
    );
  } else if (isGenericMission(mission)) {
    findings.push(
      Rules.make(
        'br-mission-generic',
        `The mission reads “${mission.slice(0, 140)}” — no customer, no category and no specific claim in it.`,
        {},
        [{ label: 'Mission', value: mission.slice(0, 160) }],
      ),
    );
  }
  if (!values) {
    findings.push(
      Rules.make(
        'br-no-values',
        'No section names the company values or principles.',
        {},
        [{ label: 'Pages searched', value: String(live.length) }],
      ),
    );
  }

  return {
    findings,
    coverage,
    metrics: {
      logos: logoList,
      families,
      accents: pal.accents,
      og_missing: noOg.length,
      tagline: tag,
      voice,
      name_variants: variants,
      cliches,
      mission,
      values,
      competitors: competitors.map((c) => String(c.host ?? '')),
      audience,
      pages: live.map(pagePath),
    },
  };
}

// ------------------------------------------------------------------ helpers

function pagePath(p: Record<string, unknown>): string {
  try {
    const path = new URL(String(p.final_url)).pathname;
    return path === '' || path === '/' ? '/' : path.replace(/\/$/, '');
  } catch {
    return '/';
  }
}

function assetKey(url: string): string {
  if (url.startsWith('inline-svg:')) return url;
  return url.split('?')[0].toLowerCase();
}

export function shortAsset(url: string): string {
  if (url.startsWith('inline-svg:')) return 'inline SVG lockup';
  try {
    const path = new URL(url).pathname;
    const base = path.split('/').filter(Boolean).pop() ?? '';
    return base || url;
  } catch {
    return url;
  }
}

export function fontFamilies(css: string, pages: Array<Record<string, unknown>>): string[] {
  const generic = [
    'inherit',
    'initial',
    'unset',
    'sans-serif',
    'serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    '-apple-system',
    'blinkmacsystemfont',
    'ui-sans-serif',
    'ui-serif',
    'ui-monospace',
    'segoe ui',
    'roboto',
    'helvetica neue',
    'helvetica',
    'arial',
    'apple color emoji',
    'segoe ui emoji',
    'segoe ui symbol',
    'noto color emoji',
    'sans',
    'var',
    'emoji',
  ];

  const found: Record<string, string> = {};
  const re = /font-family\s*:\s*([^;{}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const first = normaliseFamily(m[1].split(',')[0].trim());
    if (
      first === '' ||
      generic.includes(first.toLowerCase()) ||
      isIconFont(first)
    ) {
      continue;
    }
    if (!/^[A-Za-z0-9 \-.]{2,40}$/.test(first)) continue;
    found[first.toLowerCase()] = first;
  }
  for (const p of pages) {
    for (const href of (p.stylesheets as string[]) ?? []) {
      const famRe = /family=([^&:;]+)/gi;
      let mm: RegExpExecArray | null;
      while ((mm = famRe.exec(String(href))) !== null) {
        const fam = normaliseFamily(
          decodeURIComponent(mm[1].replace(/\+/g, ' ')).trim(),
        );
        if (
          fam !== '' &&
          !generic.includes(fam.toLowerCase()) &&
          !isIconFont(fam)
        ) {
          found[fam.toLowerCase()] = fam;
        }
      }
    }
  }
  return Object.keys(found)
    .sort()
    .map((k) => found[k]);
}

function isIconFont(name: string): boolean {
  return /(icon|icomoon|fontello|glyph|symbols?$|dashicons|themify|swiper|slick)/i.test(name);
}

/** Build tools emit `__Barlow_daff4f`; that is one typeface, not three. */
function normaliseFamily(name: string): string {
  name = name.replace(/^[\s\t\n\r\0\x0B"']+|[\s\t\n\r\0\x0B"']+$/g, '');
  if (name === '' || name.toLowerCase().includes('_fallback')) return '';
  name = name.replace(/^_+/, '');
  name = name.replace(/_[0-9a-f]{4,10}$/i, '');
  name = name.replace(/_/g, ' ');
  return name.replace(/\s+/g, ' ').trim();
}

export function palette(css: string): {
  accents: string[];
  hues: number[];
  category_only: boolean;
} {
  const counts: Record<string, number> = {};
  const hexRe = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(css)) !== null) {
    let hex = m[1].toLowerCase();
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    const key = '#' + hex;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const rgbRe = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/gi;
  while ((m = rgbRe.exec(css)) !== null) {
    const hex =
      '#' +
      [Number(m[1]), Number(m[2]), Number(m[3])]
        .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
        .join('');
    counts[hex] = (counts[hex] ?? 0) + 1;
  }

  const accents: Record<string, number> = {};
  const hues: Record<number, number> = {};
  for (const [hex, n] of Object.entries(counts)) {
    const [h, s, l] = hexToHsl(hex);
    if (s < 0.22 || l < 0.12 || l > 0.92 || n < 2) continue;
    accents[hex] = n;
    const bucket = Math.floor(h / 15) * 15;
    hues[bucket] = (hues[bucket] ?? 0) + n;
  }

  const accentEntries = Object.entries(accents).sort((a, b) => b[1] - a[1]);
  const hueEntries = Object.entries(hues).sort((a, b) => b[1] - a[1]);

  let categoryOnly = false;
  if (hueEntries.length) {
    categoryOnly = true;
    let hasGreen = false;
    let hasRed = false;
    for (const [hStr] of hueEntries) {
      const h = Number(hStr);
      const isGreen = h >= 90 && h <= 165;
      const isRed = h <= 20 || h >= 340;
      if (!isGreen && !isRed) categoryOnly = false;
      hasGreen = hasGreen || isGreen;
      hasRed = hasRed || isRed;
    }
    categoryOnly = categoryOnly && hasGreen && hasRed;
  }

  return {
    accents: accentEntries.slice(0, 14).map(([hex]) => hex),
    hues: hueEntries.map(([h]) => Number(h)),
    category_only: categoryOnly,
  };
}

export function hueBucket(hex: string): number {
  const [h] = hexToHsl(hex);
  return Math.floor(h / 30) * 30;
}

function hexToHsl(hex: string): [number, number, number] {
  hex = hex.replace(/^#/, '');
  if (hex.length !== 6) return [0, 0, 0];
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = (((g - b) / d + (g < b ? 6 : 0)) % 6 + 6) % 6;
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}

/** Sentence-length spread and jargon density across the pages. */
function voiceStats(pages: Array<Record<string, unknown>>): {
  pages: number;
  mean_sentence: number;
  min_sentence: number;
  max_sentence: number;
  sentence_cv: number;
  jargon_rate: number;
  jargon_top: string[];
  words: number;
} {
  const averages: number[] = [];
  const jargon: Record<string, number> = {};
  let words = 0;
  const terms = [
    'leverage',
    'synergy',
    'holistic',
    'robust',
    'seamless',
    'bespoke',
    'ecosystem',
    'paradigm',
    'utilise',
    'utilize',
    'facilitate',
    'optimise',
    'optimize',
    'innovative',
    'solutions',
    'offerings',
    'orientation',
    'granular',
    'scalable',
    'disruptive',
    'best-in-class',
    'value-added',
    'end-to-end',
    'state-of-the-art',
  ];

  for (const p of pages) {
    const text = String(p.text ?? '');
    if (charLen(text) < 400) continue;
    const stats = DocumentFile.readability(text);
    if (stats.sentences >= 4) averages.push(stats.avg_sentence);
    words += stats.words;
    const low = text.toLowerCase();
    for (const t of terms) {
      const n = countOccurrences(low, t);
      if (n > 0) jargon[t] = (jargon[t] ?? 0) + n;
    }
  }

  const jargonTop = Object.entries(jargon)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  const mean = averages.length
    ? averages.reduce((a, b) => a + b, 0) / averages.length
    : 0;
  let cv = 0;
  if (averages.length >= 2 && mean > 0) {
    let v = 0;
    for (const a of averages) v += (a - mean) ** 2;
    cv = Math.sqrt(v / averages.length) / mean;
  }

  return {
    pages: averages.length,
    mean_sentence: Math.round(mean * 10) / 10,
    min_sentence: averages.length ? Math.min(...averages) : 0,
    max_sentence: averages.length ? Math.max(...averages) : 0,
    sentence_cv: Math.round(cv * 100) / 100,
    jargon_rate: words > 0 ? Object.values(jargon).reduce((a, b) => a + b, 0) / words : 0,
    jargon_top: jargonTop,
    words,
  };
}

/** A line the brand repeats across pages — its positioning statement. */
function tagline(pages: Array<Record<string, unknown>>): string | null {
  const candidates: Record<string, number> = {};
  for (const p of pages) {
    const lines = [
      String((p.og as Record<string, string>)?.title ?? ''),
      String(p.title ?? ''),
      String(((p.h1 as string[]) ?? [])[0] ?? ''),
    ];
    for (const line of lines) {
      for (const chunk of line.split(/\s+[|\-–—·:]\s+/u)) {
        const c = chunk.trim();
        if (charLen(c) < 12 || charLen(c) > 90) continue;
        const key = c.toLowerCase();
        candidates[key] = (candidates[key] ?? 0) + 1;
      }
    }
  }
  const sorted = Object.entries(candidates).sort((a, b) => b[1] - a[1]);
  for (const [line, count] of sorted) {
    if (count >= 2) return line;
  }
  return null;
}

function nameVariants(pages: Array<Record<string, unknown>>, company: string): string[] {
  const stemVal = stem(company);
  if (stemVal === '') return [];
  const variants: Record<string, string> = {};
  for (const p of pages) {
    const bits: string[] = [String((p.og as Record<string, string>)?.site_name ?? '')];
    for (const n of ((p.jsonld as Record<string, unknown>)?.org_names as string[]) ?? []) {
      bits.push(String(n));
    }
    for (const chunk of String(p.title ?? '').split(/\s+[|\-–—·:]\s+/u)) {
      bits.push(chunk);
    }
    for (const raw of bits) {
      const c = raw.replace(/\s+/gu, ' ').trim();
      if (c === '' || charLen(c) > 60 || !stem(c).includes(stemVal)) continue;
      variants[c.toLowerCase()] = c;
    }
  }
  return Object.keys(variants)
    .sort()
    .map((k) => variants[k]);
}

function stem(s: string): string {
  s = s.toLowerCase();
  s =
    s.replace(
      /\b(ltd|limited|pvt|private|inc|llp|plc|co|company|group|india|markets?|capital|securities|broking|financial services)\b/gu,
      ' ',
    ) ?? s;
  s = s.replace(/[^a-z0-9]/gu, '') ?? s;
  return s.slice(0, 12);
}

function audienceTerms(audience: string): string[] {
  const stop = [
    'the',
    'and',
    'for',
    'with',
    'who',
    'are',
    'our',
    'that',
    'they',
    'their',
    'from',
    'people',
    'customers',
    'clients',
    'users',
    'audience',
    'target',
    'want',
    'need',
    'looking',
  ];
  const words = audience.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  const terms: Record<string, boolean> = {};
  for (const w of words) {
    if (charLen(w) < 4 || stop.includes(w)) continue;
    terms[w] = true;
  }
  return Object.keys(terms).slice(0, 10);
}

function findStatement(
  pages: Array<Record<string, unknown>>,
  pattern: RegExp,
): string | null {
  for (const p of pages) {
    const text = String(p.text ?? '');
    if (text === '') continue;
    const m = pattern.exec(text);
    if (!m || m.index === undefined) continue;
    const slice = text.slice(m.index).slice(0, 220).trim();
    if (slice !== '') return slice;
  }
  return null;
}

function isGenericMission(mission: string): boolean {
  const t = mission.toLowerCase();
  for (const phrase of CLICHES) {
    if (t.includes(phrase)) return true;
  }
  return charLen(t) < 60;
}

function jaccard(a: string, b: string): number {
  const stop = [
    'the',
    'and',
    'for',
    'with',
    'your',
    'you',
    'our',
    'from',
    'that',
    'this',
    'are',
    'best',
  ];
  const tok = (s: string): string[] => {
    const w = s.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
    return [
      ...new Set(w.filter((x) => charLen(x) > 3 && !stop.includes(x))),
    ];
  };
  const wa = tok(a);
  const wb = tok(b);
  if (!wa.length || !wb.length) return 0;
  const setB = new Set(wb);
  const inter = wa.filter((x) => setB.has(x)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? inter / union : 0;
}

function intersect<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return [...new Set(a.filter((x) => setB.has(x)))];
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

const Branding = { run, shortAsset, fontFamilies, palette, hueBucket };
export default Branding;
