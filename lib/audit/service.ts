/**
 * Runs one scoped audit as a sequence of short steps.
 *
 * Shared hosting has no workers and a short max_execution_time, so the browser
 * drives the run: one HTTP request per step, each well inside the budget. State
 * lives in the database between steps, never in memory.
 *
 * Complete port of legacy/app/Audit/Service.php.
 */
import { createHash, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';

import LandingPage from '@/lib/audit/analyzer/landingPage';
import SocialMedia from '@/lib/audit/analyzer/socialMedia';
import DocumentFile from '@/lib/audit/analyzer/documentFile';
import Branding from '@/lib/audit/analyzer/branding';
import Crawler from '@/lib/audit/crawler';
import Shot from '@/lib/audit/shot';
import Scorer from '@/lib/audit/scorer';
import Playbook from '@/lib/audit/playbook';
import Types from '@/lib/audit/types';
import type { Finding } from '@/lib/audit/rules';
import { putArtifact, getArtifact, run, one } from '@/lib/db';
import DocText from '@/lib/docText';
import { Html } from '@/lib/html';
import { Http } from '@/lib/http/http';
import UrlGuard from '@/lib/http/urlGuard';
import { config } from '@/lib/config';
import { token, now, clientIp, storagePath } from '@/lib/util';

export type AuditRow = Record<string, unknown>;
export type LogLine = { text: string; strong: boolean };

function mbSubstr(s: string, start: number, length?: number): string {
  const chars = [...s];
  if (length === undefined) return chars.slice(start).join('');
  return chars.slice(start, start + length).join('');
}

function mbLen(s: string): number {
  return [...s].length;
}

function mbLower(s: string): string {
  return s.toLocaleLowerCase();
}

function ucfirst(s: string): string {
  if (s === '') return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function numberFormat(n: number, decimals = 0): string {
  if (decimals > 0) {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return Math.round(n).toLocaleString('en-US');
}

function decodeXmlEntities(t: string): string {
  return t
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseJsonObject(raw: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : fallback;
  } catch {
    return fallback;
  }
}

function safeUrlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function safeUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export class Service {
  private http: Http;
  private deadline: number;

  constructor() {
    const crawl = (config('crawl', {}) as Record<string, unknown>) ?? {};
    this.http = new Http(crawl as ConstructorParameters<typeof Http>[0]);
    this.deadline = Date.now() / 1000 + Number(config('step_budget', 20));
  }

  /** The steps the browser should walk for this audit type. */
  static steps(type: string): string[] {
    if (!Types.exists(type)) return ['finalize'];
    const ids = Types.get(type).steps.map((s) => s.id);
    ids.push('finalize');
    return ids;
  }

  // ------------------------------------------------------------------- create

  async create(input: Record<string, unknown>): Promise<{
    id: string;
    token: string;
    type: string;
    steps: string[];
  }> {
    const type = String(input.type ?? '');
    if (!Types.exists(type)) {
      throw new Error('Choose which audit to run.');
    }

    const company = String(input.company ?? '').trim();
    if (company === '') {
      throw new Error('Add a company name before we scan.');
    }

    const answers: Record<string, unknown> = {};
    const allowPrivate = Boolean(config('crawl.allow_private_hosts', false));

    for (const field of Types.fields(type)) {
      const name = String(field.name);
      let val: unknown = input[name] ?? '';
      val = typeof val === 'string' ? val.trim() : val;

      if ((field.kind ?? '') === 'url' && typeof val === 'string' && val !== '') {
        const check = await UrlGuard.check(val, allowPrivate);
        if (!check.ok) {
          throw new Error(`${field.label}: ${check.error}.`);
        }
        val = check.normalised;
      }
      if (
        Boolean(field.required) &&
        (field.kind ?? '') !== 'file' &&
        (val === '' || val === null || val === undefined)
      ) {
        throw new Error(
          `${field.label} is required for a ${mbLower(Types.get(type).name)} audit.`,
        );
      }
      answers[name] = val;
    }

    // Type-specific entry requirements.
    let upload: ReturnType<typeof Service.findUpload> = null;
    if (type === Types.DOCUMENT) {
      const uploadId = String(input.upload_id ?? '').trim();
      if (uploadId !== '') {
        upload = Service.findUpload(uploadId);
        if (!upload) {
          throw new Error('That upload has expired. Choose the file again.');
        }
        answers.upload_id = uploadId;
      } else if (String(answers.url ?? '') === '') {
        throw new Error('Upload a document or paste a link to one.');
      }
    }
    if (type === Types.SOCIAL) {
      let any = false;
      for (const net of ['instagram', 'facebook', 'linkedin', 'youtube', 'x']) {
        if (String(answers[net] ?? '') !== '') {
          any = true;
        }
      }
      if (!any) {
        throw new Error('Add at least one social profile URL.');
      }
    }

    const id = token(16).replace(/-/g, '').slice(0, 32);
    const tok = token(16);
    const site = String(answers.url ?? (upload?.name ?? ''));

    run(
      `INSERT INTO dk_audits (id, token, created_at, updated_at, status, step, audit_type, company, sector, site, structure, answers, manual, tier, followup_day, closed, client_ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
      [
        id,
        tok,
        now(),
        now(),
        'running',
        Service.steps(type)[0],
        type,
        mbSubstr(company, 0, 180),
        mbSubstr(String(answers.sector ?? ''), 0, 110),
        mbSubstr(site, 0, 480),
        mbSubstr(String(answers.structure ?? ''), 0, 4000),
        JSON.stringify(answers),
        JSON.stringify([]),
        'growth',
        'Tuesday',
        clientIp(),
      ],
    );
    putArtifact(id, 'log', []);

    return { id, token: tok, type, steps: Service.steps(type) };
  }

  // --------------------------------------------------------------------- step

  async step(audit: AuditRow, step: string): Promise<Record<string, unknown>> {
    const id = String(audit.id);
    const type = String(audit.audit_type);
    const answers = parseJsonObject(audit.answers);
    const steps = Service.steps(type);

    if (!steps.includes(step)) {
      throw new Error('Unknown step for this audit.');
    }

    let log: LogLine[];
    try {
      log =
        step === 'finalize'
          ? await this.finalize(audit, type, answers)
          : await this.runStep(audit, type, step, answers);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      run('UPDATE dk_audits SET status = ?, error = ?, updated_at = ? WHERE id = ?', [
        'failed',
        message,
        now(),
        id,
      ]);
      throw e;
    }

    const stored = (getArtifact(id, 'log', []) as LogLine[]) ?? [];
    const nextStored = Array.isArray(stored) ? [...stored] : [];
    for (const line of log) {
      nextStored.push(line);
    }
    putArtifact(id, 'log', nextStored.slice(-40));

    const index = steps.indexOf(step);
    const next = steps[index + 1] ?? null;
    run('UPDATE dk_audits SET step = ?, updated_at = ? WHERE id = ?', [
      next ?? 'done',
      now(),
      id,
    ]);

    return { step, next, done: next === null, log };
  }

  private async runStep(
    audit: AuditRow,
    type: string,
    step: string,
    answers: Record<string, unknown>,
  ): Promise<LogLine[]> {
    switch (type) {
      case Types.LANDING:
        return this.landingStep(audit, step, answers);
      case Types.SOCIAL:
        return this.socialStep(audit, step, answers);
      case Types.DOCUMENT:
        return this.documentStep(audit, step, answers);
      case Types.BRANDING:
        return this.brandingStep(audit, step, answers);
      default:
        return [];
    }
  }

  // ============================================================ landing steps

  private async landingStep(
    audit: AuditRow,
    step: string,
    answers: Record<string, unknown>,
  ): Promise<LogLine[]> {
    const id = String(audit.id);
    const crawler = new Crawler(this.http, 4);

    if (step === 'fetch') {
      const url = String(answers.url);
      const page = await crawler.fetchOne(url, 'landing');
      if (!page.ok) {
        throw new Error(
          `Could not read ${url} — ${(page.error as string) || 'no response'}.`,
        );
      }
      putArtifact(id, 'page', page);
      return [
        {
          text:
            `Fetched ${LandingPage.shortUrl(String(page.final_url))} · HTTP ${Number(page.status)}` +
            ` in ${numberFormat(Number(page.ttfb), 2)}s`,
          strong: true,
        },
        {
          text:
            `${LandingPage.bytes(Number(page.bytes))} of HTML · ${Number(page.image_count)} images · ` +
            `${Number(page.scripts)} scripts`,
          strong: false,
        },
      ];
    }

    if (step === 'shot') {
      const page = (getArtifact(id, 'page', {}) as Record<string, unknown>) ?? {};
      const target = String(page.final_url ?? answers.url ?? '');
      // The crawler already cleared this URL through UrlGuard and robots.
      const shot = await Shot.capture(id, target, this.deadline);
      putArtifact(id, 'shot', shot);

      if (!shot.ok) {
        // Visuals are a bonus, never a reason to fail the audit.
        return [
          {
            text: `Could not render the page — ${shot.error || 'renderer unavailable'}. Continuing without screenshots.`,
            strong: false,
          },
        ];
      }

      const belowFold = shot.boxes.filter((b) => b.below_fold).length;
      const ctas = shot.boxes.filter((b) => b.kind === 'cta').length;
      return [
        {
          text:
            `Rendered the page at ${shot.frames.desktop?.width ?? 0}px and on mobile · ` +
            `${numberFormat(shot.page_height)}px tall`,
          strong: true,
        },
        {
          text:
            `Located ${ctas} call${ctas === 1 ? '' : 's'} to action` +
            (belowFold
              ? ` · ${belowFold} marked element${belowFold === 1 ? '' : 's'} sit below the fold`
              : ' · all marked elements are above the fold'),
          strong: false,
        },
      ];
    }

    if (step === 'content') {
      const page = (getArtifact(id, 'page', {}) as Record<string, unknown>) ?? {};
      let css = String(page.inline_css ?? '');
      const sheets: Record<string, string> = {};
      for (const href of (page.stylesheets as string[]) ?? []) {
        if (Object.keys(sheets).length >= 4) break;
        if (UrlGuard.sameSite(String(page.final_url), String(href))) {
          sheets[href] = 'css';
        }
      }
      let read = 0;
      const responses = await this.http.getMany(Object.keys(sheets), this.deadline);
      for (const res of Object.values(responses)) {
        if (res.ok) {
          css += '\n' + mbSubstr(String(res.body), 0, 500000);
          read++;
        }
      }
      putArtifact(id, 'css', css);
      const h1 = (page.h1 as string[]) ?? [];
      return [
        {
          text:
            `Read ${read} stylesheet${read === 1 ? '' : 's'} · ` +
            `${numberFormat(css.length)} characters of CSS`,
          strong: false,
        },
        {
          text:
            'Headline: ' +
            (String(h1[0] ?? '') !== ''
              ? `“${mbSubstr(String(h1[0]), 0, 60)}”`
              : 'none found'),
          strong: true,
        },
      ];
    }

    if (step === 'tech') {
      // A real mobile fetch, not an assumption about one.
      const page = (getArtifact(id, 'page', {}) as Record<string, unknown>) ?? {};
      const mobile = await this.fetchAsMobile(String(page.final_url));
      putArtifact(id, 'mobile', mobile);
      return [
        {
          text: mobile.ok
            ? `Mobile user agent served ${LandingPage.bytes(Number(mobile.bytes))} · viewport tag ` +
              (mobile.viewport ? 'present' : 'missing')
            : `Mobile fetch did not complete: ${mobile.error}`,
          strong: false,
        },
      ];
    }

    if (step === 'trust') {
      // Do the policy and grievance links actually resolve?
      const page = (getArtifact(id, 'page', {}) as Record<string, unknown>) ?? {};
      const links: Record<string, string> = {};
      for (const l of (page.links as Array<Record<string, unknown>>) ?? []) {
        if (Object.keys(links).length >= 3) break;
        const hay = String(l.url ?? '') + ' ' + String(l.text ?? '');
        if (/(privacy|terms|grievance|disclosure|complaint|policy)/i.test(hay)) {
          links[String(l.url)] = 'policy';
        }
      }
      const dead: string[] = [];
      const responses = await this.http.getMany(Object.keys(links), this.deadline);
      for (const [url, res] of Object.entries(responses)) {
        if (!res.ok) {
          dead.push(url);
        }
      }
      putArtifact(id, 'policy', { checked: Object.keys(links).length, dead });
      const trust = (page.trust as Record<string, unknown>) ?? {};
      const trustKeys = Object.keys(trust);
      return [
        {
          text: trustKeys.length
            ? `Trust markers found: ${trustKeys.slice(0, 4).join(', ')}`
            : 'No regulator, registration or grievance marker on the page',
          strong: true,
        },
        {
          text:
            `${Object.keys(links).length} policy link${Object.keys(links).length === 1 ? '' : 's'} checked` +
            (dead.length
              ? `, ${dead.length} did not resolve`
              : ', all resolved'),
          strong: false,
        },
      ];
    }

    return [];
  }

  // ============================================================= social steps

  private async socialStep(
    audit: AuditRow,
    step: string,
    answers: Record<string, unknown>,
  ): Promise<LogLine[]> {
    const id = String(audit.id);
    const nets = ['instagram', 'facebook', 'linkedin', 'youtube', 'x'];

    if (step === 'reach') {
      const profiles: Record<string, Record<string, unknown>> = {};
      for (const net of nets) {
        const url = String(answers[net] ?? '').trim();
        if (url === '') continue;
        if (Date.now() / 1000 > this.deadline) {
          profiles[net] = {
            url,
            state: 'unchecked',
            status: 0,
            note: 'Not checked — step budget reached',
          };
          continue;
        }
        profiles[net] = await this.checkProfile(net, url);
      }
      putArtifact(id, 'profiles', profiles);

      const ok = Object.values(profiles).filter((p) =>
        ['ok', 'thin'].includes(String(p.state)),
      ).length;
      const blocked = Object.values(profiles).filter((p) => p.state === 'blocked').length;
      return [
        {
          text:
            `Checked ${Object.keys(profiles).length} profile${Object.keys(profiles).length === 1 ? '' : 's'} · ` +
            `${ok} readable${blocked ? `, ${blocked} blocked by the platform` : ''}`,
          strong: true,
        },
      ];
    }

    if (step === 'profile') {
      const profiles =
        (getArtifact(id, 'profiles', {}) as Record<string, Record<string, unknown>>) ?? {};
      const lines: LogLine[] = [];
      for (const [net, p] of Object.entries(profiles)) {
        if (!['ok', 'thin'].includes(String(p.state))) {
          lines.push({ text: `${ucfirst(net)}: ${String(p.note)}`, strong: false });
          continue;
        }
        const bits: string[] = [];
        bits.push(
          String(p.bio ?? '') !== ''
            ? `${mbLen(String(p.bio))}-char bio`
            : 'no bio',
        );
        bits.push(String(p.avatar ?? '') !== '' ? 'avatar' : 'no avatar');
        if (p.followers) {
          bits.push(`${numberFormat(Number(p.followers))} followers`);
        }
        lines.push({ text: `${ucfirst(String(net))}: ${bits.join(' · ')}`, strong: false });
      }
      return lines.length
        ? lines
        : [{ text: 'No profile data could be read', strong: false }];
    }

    if (step === 'cadence') {
      const profiles =
        (getArtifact(id, 'profiles', {}) as Record<string, Record<string, unknown>>) ?? {};
      let found = 0;
      for (const [net, p] of Object.entries(profiles)) {
        if (net !== 'youtube' || !p.channel_id) continue;
        if (Date.now() / 1000 > this.deadline) break;
        const feed = await this.youtubeFeed(String(p.channel_id));
        if (feed) {
          profiles[net].feed = feed;
          found += (feed.dates as string[]).length;
        }
      }
      putArtifact(id, 'profiles', profiles);
      return [
        {
          text:
            found > 0
              ? `Read ${found} recent posts from the public feed`
              : 'No public post feed available — cadence needs a manual score',
          strong: found > 0,
        },
      ];
    }

    if (step === 'signals') {
      const profiles =
        (getArtifact(id, 'profiles', {}) as Record<string, Record<string, unknown>>) ?? {};
      let auto = 0;
      for (const p of Object.values(profiles)) {
        if (['ok', 'thin'].includes(String(p.state ?? ''))) {
          auto++;
        }
        if (p.feed) {
          auto++;
        }
      }
      return [
        {
          text: `${auto} measurable signal${auto === 1 ? '' : 's'} collected`,
          strong: false,
        },
      ];
    }

    return [];
  }

  // =========================================================== document steps

  private async documentStep(
    audit: AuditRow,
    step: string,
    answers: Record<string, unknown>,
  ): Promise<LogLine[]> {
    const id = String(audit.id);

    if (step === 'ingest') {
      const uploadId = String(answers.upload_id ?? '').trim();
      let bytes: Buffer;
      let file: Record<string, unknown>;

      if (uploadId !== '') {
        const upload = Service.findUpload(uploadId);
        if (!upload || !fs.existsSync(upload.path)) {
          throw new Error('The uploaded file is no longer on the server. Upload it again.');
        }
        bytes = fs.readFileSync(upload.path);
        file = {
          name: upload.name,
          bytes: bytes.length,
          source: 'upload',
          url: '',
          mime: upload.mime,
        };
      } else {
        const url = String(answers.url);
        const res = await this.http.get(url);
        if (!res.ok) {
          throw new Error(
            `Could not download ${url} — ${res.error || 'no response'}.`,
          );
        }
        // Http stores response bodies as latin1 strings so binary files round-trip.
        bytes = Buffer.from(String(res.body), 'latin1');
        let name = 'document';
        const base = path.basename(safeUrlPath(String(res.final_url)));
        if (base && base !== '/' && base !== '.') name = base;
        file = {
          name,
          bytes: bytes.length,
          source: 'url',
          url: String(res.final_url),
          mime: String(res.content_type),
        };
        if (res.truncated) {
          file.truncated = true;
        }
      }

      putArtifact(id, 'file', file);
      putArtifact(id, 'raw', bytes.toString('base64'));
      return [
        {
          text:
            `Loaded ${String(file.name)} · ${LandingPage.bytes(Number(file.bytes))}` +
            ` from ${file.source === 'upload' ? 'upload' : 'the web'}`,
          strong: true,
        },
      ];
    }

    if (step === 'text') {
      const file = (getArtifact(id, 'file', {}) as Record<string, unknown>) ?? {};
      const rawB64 = String(getArtifact(id, 'raw', '') ?? '');
      let raw: Buffer;
      try {
        raw = Buffer.from(rawB64, 'base64');
      } catch {
        throw new Error('The staged file could not be read back.');
      }
      if (!raw.length) {
        throw new Error('The staged file could not be read back.');
      }
      const doc = await DocText.read(raw, String(file.name), String(file.mime ?? ''));
      putArtifact(id, 'doc', doc);
      run('DELETE FROM dk_artifacts WHERE audit_id = ? AND akey = ?', [id, 'raw']);

      return [
        {
          text: doc.ok
            ? `Extracted ${numberFormat(Number(doc.words))} words` +
              (doc.pages ? ` across ${doc.pages} pages` : '') +
              ` · ${(doc.headings as unknown[]).length} headings`
            : `No text could be extracted: ${doc.error}`,
          strong: true,
        },
      ];
    }

    if (step === 'style') {
      const doc = (getArtifact(id, 'doc', {}) as Record<string, unknown>) ?? {};
      const fonts = (doc.fonts as unknown[]) ?? [];
      const sizes = (doc.sizes as unknown[]) ?? [];
      const colors = (doc.colors as unknown[]) ?? [];
      return [
        {
          text:
            `${fonts.length} typeface${fonts.length === 1 ? '' : 's'}` +
            ` · ${sizes.length} type sizes · ${colors.length} colours`,
          strong: false,
        },
        {
          text:
            `Produced with ${(String(doc.producer || doc.creator) || 'an unnamed tool')}` +
            (doc.modified ? ` · last modified ${String(doc.modified)}` : ''),
          strong: false,
        },
      ];
    }

    if (step === 'review') {
      const doc = (getArtifact(id, 'doc', {}) as Record<string, unknown>) ?? {};
      const r = DocumentFile.readability(String(doc.text ?? ''));
      putArtifact(id, 'readability', r);
      return [
        {
          text:
            r.sentences > 0
              ? `Reads at grade ${r.grade} · sentences average ${r.avg_sentence} words`
              : 'Not enough prose to measure reading level',
          strong: true,
        },
      ];
    }

    return [];
  }

  // =========================================================== branding steps

  private async brandingStep(
    audit: AuditRow,
    step: string,
    answers: Record<string, unknown>,
  ): Promise<LogLine[]> {
    const id = String(audit.id);
    const crawler = new Crawler(this.http, Number(config('crawl.max_pages', 8)));

    if (step === 'site') {
      const url = String(answers.url);
      const home = await crawler.fetchOne(url, 'home');
      if (!home.ok) {
        throw new Error(
          `Could not read ${url} — ${(home.error as string) || 'no response'}.`,
        );
      }
      const targets = crawler.discover(home);
      putArtifact(id, 'pages', [this.trimPage(home, true)]);
      putArtifact(id, 'targets', targets);
      const host = safeUrlHost(String(home.final_url));
      const targetKeys = Object.keys(targets);
      return [
        {
          text: `Connected to ${host} · HTTP ${Number(home.status)}`,
          strong: true,
        },
        {
          text: targetKeys.length
            ? `Reading ${targetKeys.length} more brand pages: ${targetKeys
                .slice(0, 4)
                .map((u) => {
                  const p = safeUrlPath(u).replace(/\/$/, '') || '/';
                  return p;
                })
                .join(', ')}`
            : 'No other brand pages linked from the homepage',
          strong: false,
        },
      ];
    }

    if (step === 'identity') {
      let pages = (getArtifact(id, 'pages', []) as Array<Record<string, unknown>>) ?? [];
      const targets =
        (getArtifact(id, 'targets', {}) as Record<string, string>) ?? {};
      if (Object.keys(targets).length) {
        for (const p of await crawler.fetchMany(targets, this.deadline)) {
          pages.push(this.trimPage(p, pages.length < 4));
        }
      }
      putArtifact(id, 'pages', pages);

      let css = '';
      const sheets: Record<string, string> = {};
      outer: for (const p of pages) {
        css += '\n' + String(p.inline_css ?? '');
        for (const href of (p.stylesheets as string[]) ?? []) {
          if (Object.keys(sheets).length >= 4) break outer;
          if (UrlGuard.sameSite(String(pages[0]?.final_url), String(href))) {
            sheets[href] = 'css';
          }
        }
      }
      const sheetRes = await this.http.getMany(Object.keys(sheets), this.deadline);
      for (const res of Object.values(sheetRes)) {
        if (res.ok) {
          css += '\n' + mbSubstr(String(res.body), 0, 400000);
        }
      }
      putArtifact(id, 'css', css);

      let faviconFound = false;
      const icons = (pages[0]?.icons as unknown[]) ?? [];
      if (!icons.length && pages[0]) {
        const fav = await this.http.getRange(
          Service.origin(String(pages[0].final_url)) + '/favicon.ico',
          2048,
        );
        faviconFound = Boolean(fav.ok);
      }
      putArtifact(id, 'extra', { favicon_found: faviconFound });

      const logos: Record<string, boolean> = {};
      for (const p of pages) {
        for (const l of (p.logos as string[]) ?? []) {
          logos[l] = true;
        }
      }
      return [
        {
          text:
            `${pages.length} pages read · ${Object.keys(logos).length} logo file` +
            `${Object.keys(logos).length === 1 ? '' : 's'}` +
            ` · ${numberFormat(css.length)} characters of CSS`,
          strong: true,
        },
      ];
    }

    if (step === 'market') {
      const urls = await Service.competitorUrls(String(answers.competitors ?? ''));
      if (!urls.length) {
        putArtifact(id, 'competitors', []);
        return [
          {
            text: 'No competitors supplied — uniqueness is checked against category clichés only',
            strong: false,
          },
        ];
      }

      const rivals: Array<Record<string, unknown>> = [];
      const responses = await this.http.getMany(urls, this.deadline);
      for (const [, res] of Object.entries(responses)) {
        if (!res.ok) continue;
        const h = new Html(String(res.final_url), String(res.body));
        let css = h.ok() ? h.inlineCss() : '';
        const link = h.ok() ? h.stylesheets().slice(0, 2) : [];
        const sheetRes = await this.http.getMany(link, this.deadline);
        for (const sheet of Object.values(sheetRes)) {
          if (sheet.ok) {
            css += '\n' + mbSubstr(String(sheet.body), 0, 250000);
          }
        }
        rivals.push({
          host: safeUrlHost(String(res.final_url)),
          title: h.ok() ? h.title() : '',
          headline: h.ok() ? (h.headings(1)[0] ?? '') : '',
          css,
        });
      }
      putArtifact(id, 'competitors', rivals);
      return [
        {
          text:
            `Compared against ${rivals.length} competitor site${rivals.length === 1 ? '' : 's'}: ` +
            rivals.map((r) => String(r.host)).join(', '),
          strong: true,
        },
      ];
    }

    if (step === 'voice') {
      const pages = (getArtifact(id, 'pages', []) as Array<Record<string, unknown>>) ?? [];
      let words = 0;
      for (const p of pages) {
        words += Math.round(mbLen(String(p.text ?? '')) / 5.5);
      }
      return [
        {
          text: `Read roughly ${numberFormat(words)} words of copy for tone and mission`,
          strong: false,
        },
      ];
    }

    return [];
  }

  // ----------------------------------------------------------------- finalize

  private async finalize(
    audit: AuditRow,
    type: string,
    answers: Record<string, unknown>,
  ): Promise<LogLine[]> {
    const id = String(audit.id);

    let result: {
      findings: Finding[];
      coverage: Record<string, string>;
      metrics: Record<string, unknown>;
    };
    let sources: Array<Record<string, unknown>>;

    switch (type) {
      case Types.LANDING: {
        const page = (getArtifact(id, 'page', {}) as Record<string, unknown>) ?? {};
        const css = String(getArtifact(id, 'css', '') ?? '');
        result = LandingPage.run(page, css, answers);
        result.metrics.mobile = (getArtifact(id, 'mobile', {}) as Record<string, unknown>) ?? {};
        result.metrics.policy = (getArtifact(id, 'policy', {}) as Record<string, unknown>) ?? {};
        sources = [
          {
            url: String(page.final_url),
            status: Number(page.status),
            ttfb: Number(page.ttfb),
            bytes: Number(page.bytes),
            label: 'Landing page',
          },
        ];
        break;
      }

      case Types.SOCIAL: {
        const profiles =
          (getArtifact(id, 'profiles', {}) as Record<string, Record<string, unknown>>) ?? {};
        result = SocialMedia.run(profiles, answers);
        sources = [];
        for (const [net, p] of Object.entries(profiles)) {
          sources.push({
            url: String(p.url),
            status: Number(p.status ?? 0),
            label: SocialMedia.NETWORKS[net] ?? net,
            state: String(p.state ?? ''),
            note: String(p.note ?? ''),
          });
        }
        break;
      }

      case Types.DOCUMENT: {
        const doc = (getArtifact(id, 'doc', {}) as Record<string, unknown>) ?? {};
        const file = (getArtifact(id, 'file', {}) as Record<string, unknown>) ?? {};
        result = DocumentFile.run(doc, file, {
          ...answers,
          brand: String(audit.company),
        });
        sources = [
          {
            url: String(file.url ?? ''),
            label: String(file.name ?? 'document'),
            bytes: Number(file.bytes ?? 0),
            status: 200,
            note:
              String(doc.kind ?? '') +
              (doc.pages ? ` · ${doc.pages} pages` : ''),
          },
        ];
        break;
      }

      case Types.BRANDING:
      default: {
        const pages = (getArtifact(id, 'pages', []) as Array<Record<string, unknown>>) ?? [];
        const css = String(getArtifact(id, 'css', '') ?? '');
        const extra = (getArtifact(id, 'extra', {}) as Record<string, unknown>) ?? {};
        const rivals =
          (getArtifact(id, 'competitors', []) as Array<Record<string, unknown>>) ?? [];
        result = Branding.run(pages, css, extra, rivals, {
          ...answers,
          company: String(audit.company),
        });
        sources = pages
          .filter((p) => Boolean(p.ok))
          .map((p) => ({
            url: String(p.final_url),
            status: Number(p.status),
            ttfb: Number(p.ttfb),
            bytes: Number(p.bytes),
            label: 'Page',
          }));
        for (const r of rivals) {
          sources.push({
            url: 'https://' + String(r.host),
            label: 'Competitor',
            status: 200,
          });
        }
        break;
      }
    }

    const findings = result.findings;
    const coverage = result.coverage;
    const manual = parseJsonObject(audit.manual) as Record<string, number>;

    const scoreResult = Scorer.score(type, findings, coverage, manual);
    const orders = Scorer.workOrders(findings);
    const fixes = Playbook.fixes(type, findings);
    const bets = Playbook.bets(type, findings, String(audit.structure ?? ''));
    const dir = Playbook.direction(
      type,
      String(audit.company),
      String(audit.sector),
      findings,
      result.metrics,
    );
    const tier = Playbook.recommendTier(findings, orders, Number(scoreResult.overall));

    const payload = {
      type,
      type_name: Types.get(type).name,
      company: String(audit.company),
      sector: String(audit.sector),
      subject: String(audit.site),
      answers,
      structure: String(audit.structure ?? ''),
      score: scoreResult,
      coverage,
      findings,
      orders,
      fixes,
      bets,
      direction: dir,
      tiers: Playbook.tiers(),
      recommended_tier: tier,
      metrics: result.metrics,
      shot: getArtifact(id, 'shot', null),
      method: {
        sources: Object.values(sources),
        crawled_at: now(),
        user_agent: String(config('crawl.user_agent', '')),
      },
    };

    run(
      'UPDATE dk_audits SET status = ?, result = ?, direction = ?, tier = ?, updated_at = ? WHERE id = ?',
      [
        'complete',
        JSON.stringify(payload),
        dir.copy,
        tier,
        now(),
        id,
      ],
    );
    for (const key of ['pages', 'targets', 'page', 'css', 'raw', 'competitors', 'doc']) {
      run('DELETE FROM dk_artifacts WHERE audit_id = ? AND akey = ?', [id, key]);
    }

    const unscored = scoreResult.unscored.length;
    return [
      {
        text:
          `${findings.length} findings · score ${scoreResult.overall}/100 · ${scoreResult.grade.label}` +
          (unscored
            ? ` · ${unscored} parameter${unscored === 1 ? '' : 's'} need your score`
            : ''),
        strong: true,
      },
    ];
  }

  /** Re-score an existing audit after the consultant sets a manual mark. */
  static rescore(audit: AuditRow): Record<string, unknown> | null {
    let result: Record<string, unknown> | null = null;
    try {
      result =
        typeof audit.result === 'string'
          ? (JSON.parse(String(audit.result || 'null')) as Record<string, unknown> | null)
          : (audit.result as Record<string, unknown> | null);
    } catch {
      result = null;
    }
    if (!result || typeof result !== 'object') return null;

    const manual = parseJsonObject(audit.manual) as Record<string, number>;
    const findings = (Array.isArray(result.findings) ? result.findings : []) as Finding[];
    const coverage =
      result.coverage && typeof result.coverage === 'object'
        ? (result.coverage as Record<string, string>)
        : {};

    result.score = Scorer.score(String(audit.audit_type), findings, coverage, manual);
    run('UPDATE dk_audits SET result = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(result),
      now(),
      String(audit.id),
    ]);
    return result;
  }

  // ------------------------------------------------------------------ helpers

  /** Fetch the same URL as a phone would, to see what mobile actually gets. */
  private async fetchAsMobile(url: string): Promise<Record<string, unknown>> {
    const cfg = { ...((config('crawl', {}) as Record<string, unknown>) ?? {}) };
    cfg.user_agent =
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 (compatible; DigiKraftAuditBot/1.0)';
    const http = new Http(cfg as ConstructorParameters<typeof Http>[0]);
    const res = await http.get(url);
    if (!res.ok) {
      return { ok: false, error: String(res.error), bytes: 0, viewport: false };
    }
    const h = new Html(String(res.final_url), String(res.body));
    return {
      ok: true,
      error: '',
      bytes: Number(res.bytes),
      ttfb: Number(res.ttfb),
      viewport: h.ok() && h.hasViewportMeta(),
    };
  }

  private async checkProfile(net: string, url: string): Promise<Record<string, unknown>> {
    const res = await this.http.get(url);
    const status = Number(res.status);
    const row: Record<string, unknown> = {
      url,
      status,
      handle: SocialMedia.handle(net, url),
      state: 'unverified',
      note: '',
      bio: '',
      avatar: '',
      display_name: '',
      followers: 0,
      outbound_link: false,
    };

    if (status === 404 || status === 410) {
      row.state = 'missing';
      row.note = 'Profile not found';
      return row;
    }
    if ([401, 403, 429, 999].includes(status)) {
      row.state = 'blocked';
      row.note = `Platform blocked the check (HTTP ${status}) — score this one by hand`;
      return row;
    }
    if (status < 200 || status >= 300 || res.body === '') {
      row.note = res.error !== '' ? String(res.error) : `HTTP ${status}`;
      return row;
    }

    const h = new Html(String(res.final_url), String(res.body));
    if (!h.ok()) {
      row.note = 'Response could not be parsed';
      return row;
    }

    const ogTitle = h.og('og:title');
    const ogDesc = h.og('og:description');
    const ogImage = h.og('og:image');

    row.display_name = ogTitle.replace(/\s*[|(].*$/u, '').trim();
    row.avatar = ogImage;
    row.bio = ogDesc.trim();

    // Instagram publishes the counts in og:description; use the real numbers.
    const followersMatch = ogDesc.match(/([\d,.]+[KMkm]?)\s+Followers/);
    if (followersMatch) {
      row.followers = Service.humanNumber(followersMatch[1]);
      let bio = ogDesc.replace(/^.*?on Instagram:\s*/u, '').trim();
      if (bio === ogDesc) {
        bio = ogDesc.replace(/^[\d,.KMkm]+\s+Followers.*?-\s*/u, '').trim();
      }
      row.bio = bio;
    }
    const subMatch = String(res.body).match(
      /"subscriberCountText".{0,80}?"([\d.,]+[KMkm]?) subscribers/,
    );
    if (subMatch) {
      row.followers = Service.humanNumber(subMatch[1]);
    }
    if (net === 'youtube') {
      const ch = String(res.body).match(/"(?:externalId|channelId)":"(UC[\w-]{20,26})"/);
      if (ch) {
        row.channel_id = ch[1];
      }
    }

    // Any outbound link that leaves the platform counts as a link in bio.
    let host = '';
    try {
      host = new URL(String(res.final_url)).hostname.toLowerCase();
    } catch {
      host = '';
    }
    const hostCore = host.replace(/^www\./, '');
    for (const l of h.links().slice(0, 400)) {
      let lHost = '';
      try {
        lHost = new URL(String(l.url)).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (
        lHost !== '' &&
        !lHost.includes(hostCore) &&
        !/(facebook|instagram|linkedin|twitter|x|youtube|google|apple|microsoft|whatsapp|threads)\./.test(
          lHost,
        )
      ) {
        row.outbound_link = true;
        break;
      }
    }

    const imageKey = ogImage !== '' ? (ogImage.split('?')[0] || ogImage) : '';
    row.avatar_hash =
      ogImage !== ''
        ? createHash('md5').update(imageKey).digest('hex').slice(0, 12)
        : '';
    row.state = ogTitle !== '' || ogImage !== '' ? 'ok' : 'thin';
    row.note =
      row.state === 'ok'
        ? 'Reachable, profile data read'
        : 'Reachable, no profile data exposed';

    return row;
  }

  /** YouTube publishes a public Atom feed per channel — real dates, real titles. */
  private async youtubeFeed(
    channelId: string,
  ): Promise<{ dates: string[]; titles: string[]; views: number[] } | null> {
    const res = await this.http.get(
      'https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(channelId),
    );
    if (!res.ok) return null;
    const xml = String(res.body);
    let dates: string[] = [];
    let titles: string[] = [];
    let views: number[] = [];

    const dateMatches = xml.matchAll(/<published>([^<]+)<\/published>/g);
    dates = [...dateMatches].map((m) => m[1]);

    const titleMatches = xml.matchAll(/<media:title>([^<]*)<\/media:title>/g);
    titles = [...titleMatches].map((m) => decodeXmlEntities(m[1]));

    const viewMatches = xml.matchAll(/<media:statistics\s+views="(\d+)"/g);
    views = [...viewMatches].map((m) => Number.parseInt(m[1], 10));

    if (!dates.length) return null;
    return { dates, titles, views };
  }

  private static humanNumber(rawIn: string): number {
    let raw = rawIn.toLowerCase().trim();
    let mult = 1;
    if (raw.endsWith('k')) {
      mult = 1000;
      raw = raw.slice(0, -1);
    } else if (raw.endsWith('m')) {
      mult = 1000000;
      raw = raw.slice(0, -1);
    }
    return Math.round(Number.parseFloat(raw.replace(/,/g, '')) * mult) || 0;
  }

  private static async competitorUrls(raw: string): Promise<string[]> {
    const out: string[] = [];
    for (const lineRaw of raw.split(/[\s,]+/)) {
      const line = lineRaw.trim();
      if (line === '' || out.length >= 3) continue;
      const check = await UrlGuard.check(line, false);
      if (check.ok) {
        out.push(check.normalised);
      }
    }
    return out;
  }

  private trimPage(page: Record<string, unknown>, keepCss: boolean): Record<string, unknown> {
    const next = { ...page };
    next.inline_css = keepCss
      ? mbSubstr(String(page.inline_css ?? ''), 0, 60000)
      : '';
    next.links = ((page.links as unknown[]) ?? []).slice(0, 120);
    next.text = mbSubstr(String(page.text ?? ''), 0, 60000);
    return next;
  }

  private static origin(url: string): string {
    try {
      const p = new URL(url);
      if (!p.hostname) return url;
      return `${p.protocol}//${p.host}`;
    } catch {
      return url;
    }
  }

  // ------------------------------------------------------------------ uploads

  static findUpload(
    uploadId: string,
  ): { id: string; name: string; path: string; mime: string; bytes: number } | null {
    if (!/^[a-f0-9]{24,64}$/.test(uploadId)) {
      return null;
    }
    const row = one<Record<string, unknown>>('SELECT * FROM dk_uploads WHERE id = ?', [
      uploadId,
    ]);
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      path: storagePath('uploads/' + String(row.stored)),
      mime: String(row.mime),
      bytes: Number(row.bytes),
    };
  }

  // ------------------------------------------------------------------ records

  static find(id: string, tok: string): AuditRow | null {
    if (!id || !tok) return null;
    const row = one<AuditRow>('SELECT * FROM dk_audits WHERE id = ?', [id]);
    if (!row) return null;
    const stored = String(row.token ?? '');
    const a = Buffer.from(stored);
    const b = Buffer.from(tok);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }
    return row;
  }

  static payload(row: AuditRow): Record<string, unknown> {
    let result: Record<string, unknown> | null = null;
    try {
      const raw = row.result;
      if (typeof raw === 'string' && raw) {
        const parsed = JSON.parse(raw) as unknown;
        result =
          parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null;
      } else if (raw && typeof raw === 'object') {
        result = raw as Record<string, unknown>;
      }
    } catch {
      result = null;
    }

    const answers = parseJsonObject(row.answers);
    const manual = parseJsonObject(row.manual) as Record<string, number>;
    const type = String(row.audit_type ?? '');

    return {
      id: String(row.id),
      type,
      status: String(row.status ?? ''),
      step: String(row.step ?? ''),
      steps: Types.exists(type) ? Service.steps(type) : [],
      company: String(row.company ?? ''),
      sector: String(row.sector ?? ''),
      subject: String(row.site ?? ''),
      answers,
      manual,
      tier: String(row.tier ?? 'growth'),
      day: String(row.followup_day ?? 'Tuesday'),
      closed: Number(row.closed ?? 0) === 1,
      direction: String(row.direction ?? ''),
      created_at: String(row.created_at ?? ''),
      error: String(row.error ?? ''),
      result,
    };
  }
}

export default Service;
