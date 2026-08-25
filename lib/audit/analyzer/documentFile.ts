import * as Rules from '@/lib/audit/rules';
import type { Finding, ProofItem } from '@/lib/audit/rules';
import type { AnalyzerResult } from '@/lib/audit/analyzer/landingPage';
import LandingPage from '@/lib/audit/analyzer/landingPage';
import Pdf from '@/lib/pdf';

/**
 * Document audit — port of Analyzer/DocumentFile.php.
 */
const MISSPELLINGS: Record<string, string> = {
  seperate: 'separate',
  occured: 'occurred',
  recieve: 'receive',
  accomodate: 'accommodate',
  existance: 'existence',
  refered: 'referred',
  sucessful: 'successful',
  succesful: 'successful',
  garantee: 'guarantee',
  guarentee: 'guarantee',
  maintenence: 'maintenance',
  neccessary: 'necessary',
  occassion: 'occasion',
  priviledge: 'privilege',
  reccomend: 'recommend',
  recomend: 'recommend',
  refrence: 'reference',
  responsable: 'responsible',
  similiar: 'similar',
  begining: 'beginning',
  commited: 'committed',
  definately: 'definitely',
  independant: 'independent',
  liase: 'liaise',
  occurance: 'occurrence',
  publically: 'publicly',
  seperately: 'separately',
  acknowledgement: 'acknowledgment',
  withdrawl: 'withdrawal',
  benificiary: 'beneficiary',
  disbursment: 'disbursement',
  instalment: 'installment',
  compliancce: 'compliance',
};

const PLACEHOLDERS = [
  'lorem ipsum',
  'dolor sit amet',
  'tbd',
  'to be decided',
  'xxxx',
  'xxx,',
  '[insert',
  '[name]',
  '[date]',
  '[client]',
  '<insert',
  'placeholder text',
  'your text here',
  'sample text',
  'todo:',
  'fixme',
];

function charLen(s: string): number {
  return [...s].length;
}

export function run(
  doc: Record<string, unknown>,
  file: Record<string, unknown>,
  intake: Record<string, unknown>,
): AnalyzerResult {
  const findings: Finding[] = [];
  const coverage: Record<string, string> = {
    clarity: 'auto',
    actionability: 'auto',
    accuracy: 'auto',
    'visual-design': 'auto',
    accessibility: 'auto',
  };

  const name = String(file.name ?? 'document');
  const proof: ProofItem = { label: 'File', value: name };
  if (file.url) proof.url = String(file.url);

  if (!doc.ok || Number(doc.words) < 25) {
    findings.push(
      Rules.make(
        'doc-no-text',
        doc.error !== ''
          ? String(doc.error)
          : `Only ${Number(doc.words)} words of text could be extracted, so the file is almost certainly a set of images.`,
        {},
        [proof],
      ),
    );
    coverage.clarity = 'auto';
    coverage.actionability = 'manual';
    coverage.accuracy = 'manual';
    coverage.accessibility = 'manual';
    return {
      findings,
      coverage,
      metrics: metrics(doc, file, {}, {}),
    };
  }

  const text = String(doc.text);
  const lower = text.toLowerCase();
  const words = Number(doc.words);
  const headings = (doc.headings as Array<{ text: string }>) ?? [];
  const paragraphs = (doc.paragraphs as string[]) ?? [];
  const stats = readability(text);

  if (!headings.length && words > 250) {
    findings.push(
      Rules.make(
        'doc-no-headings',
        `No heading of any kind breaks up ${words.toLocaleString('en-US')} words.`,
        { words: words.toLocaleString('en-US') },
        [
          { label: 'Words', value: words.toLocaleString('en-US') },
          { label: 'Headings', value: '0' },
        ],
      ),
    );
  }
  if (stats.avg_sentence > 25) {
    findings.push(
      Rules.make(
        'doc-long-sentences',
        `Sentences average ${Math.round(stats.avg_sentence)} words, and the longest runs ${stats.max_sentence}.`,
        { n: String(Math.round(stats.avg_sentence)) },
        [
          { label: 'Average sentence', value: `${Math.round(stats.avg_sentence)} words` },
          { label: 'Longest sentence', value: `${stats.max_sentence} words` },
        ],
        stats.avg_sentence > 32 ? 'high' : 'medium',
      ),
    );
  }
  if (paragraphs.length) {
    const paraWords = paragraphs.map((p) => p.split(/\s+/u).filter(Boolean).length);
    const avgPara = paraWords.reduce((a, b) => a + b, 0) / paraWords.length;
    const maxPara = Math.max(...paraWords);
    if (maxPara > 140 || avgPara > 90) {
      findings.push(
        Rules.make(
          'doc-long-paragraphs',
          `The longest block runs ${maxPara} words with an average of ${Math.round(avgPara)}.`,
          { n: String(maxPara) },
          [
            { label: 'Longest block', value: `${maxPara} words` },
            { label: 'Average', value: `${Math.round(avgPara)} words` },
          ],
        ),
      );
    }
  }
  if (Number(doc.list_items) === 0 && words > 400) {
    findings.push(
      Rules.make(
        'doc-no-lists',
        `Nothing in ${words.toLocaleString('en-US')} words is set as a bulleted or numbered list.`,
        {},
        [{ label: 'List items', value: '0' }],
      ),
    );
  }
  if (stats.grade > 14) {
    findings.push(
      Rules.make(
        'doc-hard-reading',
        `A Flesch–Kincaid estimate puts this at grade ${Math.round(stats.grade * 10) / 10} — roughly ${stats.grade >= 16 ? 'postgraduate' : 'late-undergraduate'} reading.`,
        { grade: String(Math.round(stats.grade * 10) / 10) },
        [
          { label: 'Reading grade', value: String(Math.round(stats.grade * 10) / 10) },
          { label: 'Avg syllables/word', value: String(Math.round(stats.syllables * 100) / 100) },
        ],
        stats.grade > 17 ? 'high' : 'medium',
      ),
    );
  }

  const headingText = headings.map((h) => h.text).join(' | ').toLowerCase();
  const hasSummary =
    /\b(summary|overview|at a glance|key takeaways?|executive summary|in short|highlights)\b/.test(
      headingText + ' ' + lower,
    );
  const hasNext =
    /\b(next steps?|what happens next|how to (apply|start|proceed|open)|action(s| items| required)|to get started|follow(-| )up|checklist)\b/.test(
      lower,
    );
  const hasContact =
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b(?:\+91[\s-]?)?[6-9]\d{9}\b|\bcontact us\b|\bcall us\b/i.test(
      text,
    );
  const hasCta =
    /\b(open an account|get started|apply now|book a|schedule a|scan the|visit |download the|sign up|talk to|reach out|write to us)\b/.test(
      lower,
    );

  if (!hasSummary && words > 400) {
    findings.push(
      Rules.make(
        'doc-no-summary',
        `No section reads as a summary, overview or set of key takeaways anywhere in ${words.toLocaleString('en-US')} words.`,
        {},
        [{ label: 'Headings searched', value: String(headings.length) }],
      ),
    );
  }
  if (!hasNext) {
    findings.push(
      Rules.make(
        'doc-no-next-steps',
        'The text never names a next step — no "next steps", "how to apply", action list or checklist.',
        {},
        [proof],
      ),
    );
  }
  if (!hasContact) {
    findings.push(
      Rules.make(
        'doc-no-contact',
        'No email address, phone number or contact instruction appears in the document.',
        {},
        [proof],
      ),
    );
  }
  if (!hasCta) {
    findings.push(
      Rules.make(
        'doc-no-cta',
        'Nothing in the copy asks the reader to do anything.',
        {},
        [proof],
      ),
    );
  }

  const found: string[] = [];
  for (const needle of PLACEHOLDERS) {
    if (lower.includes(needle)) found.push(needle);
  }
  if (found.length) {
    findings.push(
      Rules.make(
        'doc-placeholders',
        `Unfinished text is still in the file: ${found
          .slice(0, 4)
          .map((f) => `“${f}”`)
          .join(', ')}.`,
        {},
        found.slice(0, 4).map((f) => ({ label: 'Placeholder', value: f })),
      ),
    );
  }

  const doubled: string[] = [];
  const doubledRe = /\b(\w{3,})\s+\1\b/giu;
  let dm: RegExpExecArray | null;
  while ((dm = doubledRe.exec(text)) !== null && doubled.length < 6) {
    doubled.push(dm[0].trim());
  }
  if (doubled.length >= 2) {
    findings.push(
      Rules.make(
        'doc-repeated-words',
        `Doubled words appear in the text: ${doubled
          .slice(0, 4)
          .map((d) => `“${d}”`)
          .join(', ')}.`,
        { n: String(doubled.length) },
        doubled.slice(0, 4).map((d) => ({ label: 'Doubled', value: d })),
      ),
    );
  }

  const misspelled: string[] = [];
  for (const [wrong, right] of Object.entries(MISSPELLINGS)) {
    const re = new RegExp('\\b' + wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'iu');
    if (re.test(text)) misspelled.push(`${wrong} → ${right}`);
  }
  if (misspelled.length) {
    findings.push(
      Rules.make(
        'doc-misspellings',
        `A mechanical check against a list of commonly-confused spellings flagged: ${misspelled
          .slice(0, 4)
          .join(', ')}. This is not a full proofread.`,
        { n: String(misspelled.length) },
        misspelled.slice(0, 5).map((m2) => ({ label: 'Spelling', value: m2 })),
      ),
    );
  }

  let spacing = 0;
  spacing += (text.match(/\s[,.;:]/gu) ?? []).length;
  spacing += (text.match(/[a-z][,.][A-Za-z]/gu) ?? []).length;
  spacing += (text.match(/\(\s|\s\)/gu) ?? []).length;
  if (spacing >= 6) {
    findings.push(
      Rules.make(
        'doc-spacing',
        `${spacing} places have a space before punctuation, a missing space after it, or stray bracket spacing.`,
        { n: String(spacing) },
        [{ label: 'Spacing slips', value: String(spacing) }],
      ),
    );
  }

  const brand = String(intake.brand ?? '').trim();
  if (brand !== '') {
    const variants = brandVariants(text, brand);
    if (variants.length > 1) {
      findings.push(
        Rules.make(
          'doc-brand-drift',
          `The brand appears as ${variants
            .slice(0, 4)
            .map((v) => `“${v}”`)
            .join(' / ')} in the same file.`,
          { n: Rules.spell(variants.length) },
          variants.slice(0, 4).map((v) => ({ label: 'Spelling', value: v })),
        ),
      );
    }
  }

  const date = (doc.modified || doc.created) as string | null;
  if (date) {
    const ts = Date.parse(String(date));
    if (ts) {
      const months = Math.floor((Date.now() - ts) / (30.44 * 86400000));
      if (months >= 18) {
        findings.push(
          Rules.make(
            'doc-stale',
            `The file was last modified ${date} — ${age(months)} ago.`,
            { date: String(date) },
            [
              { label: 'Last modified', value: String(date) },
              { label: 'Age', value: age(months) },
            ],
            months >= 30 ? 'high' : 'medium',
          ),
        );
      }
    }
  }

  const fonts = (doc.fonts as string[]) ?? [];
  if (fonts.length > 3) {
    findings.push(
      Rules.make(
        'doc-font-sprawl',
        `${fonts.length} typefaces are embedded: ${fonts.slice(0, 6).join(', ')}.`,
        { n: Rules.spell(fonts.length) },
        fonts.slice(0, 6).map((f) => ({ label: 'Typeface', value: f })),
      ),
    );
  }
  const sizes = Object.keys((doc.sizes as Record<string, number>) ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  if (sizes.length > 8) {
    findings.push(
      Rules.make(
        'doc-size-sprawl',
        `${sizes.length} distinct type sizes are used, from ${sizes[0]}pt to ${sizes[sizes.length - 1]}pt.`,
        { n: String(sizes.length) },
        [
          { label: 'Distinct sizes', value: String(sizes.length) },
          { label: 'Range', value: `${sizes[0]}pt – ${sizes[sizes.length - 1]}pt` },
        ],
      ),
    );
  }
  const tool = String(doc.producer || doc.creator || '').trim();
  if (
    tool !== '' &&
    Pdf.isOfficeExport(
      doc.producer as string | null,
      doc.creator as string | null,
    )
  ) {
    findings.push(
      Rules.make(
        'doc-office-export',
        `The file was exported straight from ${tool} with no design layer applied.`,
        { tool },
        [{ label: 'Produced with', value: tool }],
      ),
    );
  }
  if (String(doc.title ?? '').trim() === '') {
    findings.push(
      Rules.make(
        'doc-no-title-meta',
        `The file carries no title in its metadata, so it surfaces as “${name}”.`,
        {},
        [proof],
      ),
    );
  }
  const bytes = Number(file.bytes ?? doc.bytes);
  if (bytes > 5 * 1048576) {
    findings.push(
      Rules.make(
        'doc-heavy',
        `The file is ${LandingPage.bytes(bytes)} across ${doc.pages || '?'} pages.`,
        { weight: LandingPage.bytes(bytes) },
        [{ label: 'File size', value: LandingPage.bytes(bytes) }],
      ),
    );
  }

  const bodySize = Number(doc.body_size);
  if (bodySize > 0 && bodySize < 9) {
    findings.push(
      Rules.make(
        'doc-tiny-type',
        `Most of the text is set at ${bodySize}pt, below the 9pt floor for readable print.`,
        { size: String(bodySize) },
        [{ label: 'Body size', value: `${bodySize}pt` }],
      ),
    );
  } else if (bodySize === 0) {
    coverage.accessibility = 'manual';
  }

  const contrast = textContrast((doc.colors as Record<string, number>) ?? {});
  if (contrast !== null && contrast.ratio < 4.5) {
    findings.push(
      Rules.make(
        'doc-low-contrast',
        `The dominant text colour ${contrast.fg} against ${contrast.bg} measures ${contrast.ratio.toFixed(1)}:1.`,
        { ratio: contrast.ratio.toFixed(1) },
        [
          { label: 'Text', value: contrast.fg },
          { label: 'Page', value: contrast.bg },
          { label: 'Ratio', value: `${contrast.ratio.toFixed(1)}:1` },
        ],
      ),
    );
  }
  if (String(doc.lang ?? '').trim() === '') {
    findings.push(
      Rules.make('doc-no-lang', 'No language is declared in the file metadata.', {}, [proof]),
    );
  }
  if (doc.kind === 'pdf' && !doc.tagged) {
    findings.push(
      Rules.make(
        'doc-untagged',
        'The PDF has no structure tree, so assistive technology reads it as one undifferentiated block.',
        {},
        [{ label: 'StructTreeRoot', value: 'absent' }],
      ),
    );
  }

  return {
    findings,
    coverage,
    metrics: metrics(doc, file, stats, contrast ?? {}),
  };
}

function metrics(
  doc: Record<string, unknown>,
  file: Record<string, unknown>,
  stats: Record<string, unknown>,
  contrast: Record<string, unknown>,
): Record<string, unknown> {
  const sizes = (doc.sizes as Record<string, number>) ?? {};
  const colors = (doc.colors as Record<string, number>) ?? {};
  return {
    name: String(file.name ?? ''),
    source: String(file.source ?? ''),
    url: String(file.url ?? ''),
    kind: String(doc.kind),
    bytes: Number(file.bytes ?? doc.bytes),
    pages: doc.pages,
    words: Number(doc.words),
    headings: ((doc.headings as unknown[]) ?? []).length,
    lists: Number(doc.list_items),
    fonts: (doc.fonts as string[]) ?? [],
    sizes: Object.fromEntries(Object.entries(sizes).slice(0, 10)),
    colors: Object.fromEntries(Object.entries(colors).slice(0, 8)),
    body_size: doc.body_size,
    title: String(doc.title ?? ''),
    producer: String(doc.producer || doc.creator || ''),
    modified: doc.modified || doc.created,
    lang: String(doc.lang ?? ''),
    tagged: Boolean(doc.tagged),
    readability: stats,
    contrast,
  };
}

/** Flesch–Kincaid grade plus the raw sentence stats behind it. */
export function readability(text: string): {
  avg_sentence: number;
  max_sentence: number;
  syllables: number;
  grade: number;
  sentences: number;
  words: number;
} {
  let sentences = text.trim().split(/(?<=[.!?])\s+/u);
  sentences = sentences.filter((s) => s.trim().split(/\s+/u).filter(Boolean).length >= 3);
  let words = text.trim().split(/\s+/u);
  words = words.filter((w) => /[a-z]/i.test(w));

  if (!sentences.length || !words.length) {
    return {
      avg_sentence: 0,
      max_sentence: 0,
      syllables: 0,
      grade: 0,
      sentences: 0,
      words: words.length,
    };
  }

  const lengths = sentences.map((s) => s.trim().split(/\s+/u).filter(Boolean).length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  let syllableCount = 0;
  for (const w of words) syllableCount += countSyllables(w);
  const perWord = syllableCount / words.length;
  const grade = 0.39 * avg + 11.8 * perWord - 15.59;

  return {
    avg_sentence: Math.round(avg * 10) / 10,
    max_sentence: Math.max(...lengths),
    syllables: Math.round(perWord * 100) / 100,
    grade: Math.round(Math.max(0, grade) * 10) / 10,
    sentences: sentences.length,
    words: words.length,
  };
}

function countSyllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/gi, '');
  if (w === '') return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  w = w.replace(/^y/, '');
  const n = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, n ? n.length : 0);
}

function brandVariants(text: string, brand: string): string[] {
  let stem = brand.toLowerCase().replace(/[^a-z]/gi, '');
  stem = [...stem].slice(0, 8).join('');
  if (charLen(stem) < 4) return [];
  const pattern = new RegExp(
    '\\b' + [...stem].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\\-]?') + '[A-Za-z]*\\b',
    'iu',
  );
  const matches = text.match(pattern);
  if (!matches) return [];
  const seen: Record<string, boolean> = {};
  for (const hit of matches) {
    const t = hit.trim();
    if (t !== '') seen[t] = true;
  }
  return Object.keys(seen).slice(0, 6);
}

function textContrast(
  colors: Record<string, number>,
): { fg: string; bg: string; ratio: number } | null {
  if (Object.keys(colors).length < 2) return null;
  const hexes = Object.entries(colors)
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex);

  let bg: { hex: string; rgb: [number, number, number]; lum: number } | null = null;
  let fg: { hex: string; rgb: [number, number, number]; lum: number } | null = null;
  for (const hex of hexes) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    const lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
    if (!bg || lum > bg.lum) bg = { hex, rgb, lum };
    if (!fg || lum < fg.lum) fg = { hex, rgb, lum };
  }
  if (!bg || !fg || bg.hex === fg.hex) return null;
  return {
    fg: fg.hex,
    bg: bg.hex,
    ratio: LandingPage.contrastRatio(fg.rgb, bg.rgb),
  };
}

function hexToRgb(hex: string): [number, number, number] | null {
  hex = hex.replace(/^#/, '');
  if (hex.length !== 6 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function age(months: number): string {
  if (months < 24) return `${months} months`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return `${years} year${years === 1 ? '' : 's'}${rem >= 3 ? ` ${rem} months` : ''}`;
}

const DocumentFile = { run, readability };
export default DocumentFile;
