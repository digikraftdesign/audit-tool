/**
 * Screenshots of the page the audit actually read.
 *
 * The crawler works from HTML, so nothing in the audit proves what the page
 * *looks* like. This renders the same final URL in headless Chromium and keeps
 * three frames: the desktop fold (what a paid click sees before scrolling), the
 * full desktop page, and the mobile fold.
 *
 * It also measures the boxes of the elements findings talk about — headline,
 * primary CTAs, forms — so the diagnose view can point at them on the image
 * instead of describing them in prose.
 *
 * Never fatal. Chromium may be absent (shared hosting, slim images) or the page
 * may hang; either way the audit completes without visuals.
 */
import fs from 'fs';
import path from 'path';

import { config } from '@/lib/config';
import { storagePath } from '@/lib/util';

export interface ShotBox {
  kind: 'headline' | 'cta' | 'form' | 'nav' | 'media';
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** True when the box sits entirely below the desktop fold. */
  below_fold: boolean;
}

export interface ShotFrame {
  variant: 'desktop' | 'desktop-full' | 'mobile';
  file: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ShotResult {
  ok: boolean;
  error: string;
  url: string;
  captured_at: string;
  /** Viewport height used for the desktop fold, in CSS pixels. */
  fold_height: number;
  /** Full scroll height of the desktop render, in CSS pixels. */
  page_height: number;
  /** Share of the page that sits above the fold, 0..1. */
  fold_ratio: number;
  frames: Record<string, ShotFrame>;
  boxes: ShotBox[];
  /** Dominant background colour of the fold, as reported by the page. */
  background: string;
}

function blank(url: string): ShotResult {
  return {
    ok: false,
    error: '',
    url,
    captured_at: '',
    fold_height: 0,
    page_height: 0,
    fold_ratio: 0,
    frames: {},
    boxes: [],
    background: '',
  };
}

/** Where a captured frame lives on disk. */
export function shotPath(auditId: string, variant: string): string {
  const safeId = auditId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeVariant = variant.replace(/[^a-z-]/g, '');
  return storagePath(path.join('shots', `${safeId}-${safeVariant}.jpg`));
}

/**
 * Runs inside the page. Returns the boxes worth annotating.
 * Kept dependency-free — it is serialised across the CDP boundary.
 */
/* c8 ignore start — executes in the browser, not under node coverage */
function collectBoxes(foldHeight: number): {
  boxes: ShotBox[];
  pageHeight: number;
  background: string;
} {
  const out: ShotBox[] = [];
  const seen = new Set<Element>();

  const push = (
    el: Element,
    kind: ShotBox['kind'],
    label: string,
  ): void => {
    if (seen.has(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return;
    if (Number(style.opacity) === 0) return;
    seen.add(el);
    const top = r.top + window.scrollY;
    out.push({
      kind,
      label,
      x: Math.round(r.left + window.scrollX),
      y: Math.round(top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90),
      below_fold: top >= foldHeight,
    });
  };

  const h1 = document.querySelector('h1');
  if (h1) push(h1, 'headline', 'Headline');

  const nav = document.querySelector('header nav, nav, header');
  if (nav) push(nav, 'nav', 'Navigation');

  // Primary conversion controls, in the order a visitor meets them.
  const ctaSelector = [
    'a[href*="signup" i]',
    'a[href*="sign-up" i]',
    'a[href*="register" i]',
    'a[href*="open" i]',
    'a[href*="demo" i]',
    'a[href*="start" i]',
    'a[href*="contact" i]',
    'button[type="submit"]',
    'input[type="submit"]',
    '[role="button"]',
    '.btn',
    '.button',
    '.cta',
  ].join(',');
  let ctas = 0;
  document.querySelectorAll(ctaSelector).forEach((el) => {
    if (ctas >= 6) return;
    const text = (el.textContent ?? '').trim();
    if (text.length > 60) return;
    push(el, 'cta', text ? `CTA · ${text.slice(0, 28)}` : 'CTA');
    ctas += 1;
  });

  const form = document.querySelector('form');
  if (form) push(form, 'form', 'Form');

  const hero = document.querySelector(
    'main img, header img, section img, video',
  );
  if (hero) push(hero, 'media', 'Hero media');

  const body = window.getComputedStyle(document.body);

  return {
    boxes: out.slice(0, 14),
    pageHeight: Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    ),
    background: body.backgroundColor || '',
  };
}
/* c8 ignore stop */

/**
 * Capture the frames for one audit.
 * `url` must already have passed UrlGuard and robots — this re-renders a page
 * the crawler was allowed to fetch, it does not widen the crawl surface.
 */
export async function capture(
  auditId: string,
  url: string,
  deadline?: number,
): Promise<ShotResult> {
  const result = blank(url);
  const cfg = config('shot') as ReturnType<typeof config> & {
    enabled: boolean;
    timeout: number;
    desktop_width: number;
    desktop_height: number;
    mobile_width: number;
    mobile_height: number;
    max_full_height: number;
    quality: number;
  };

  if (!cfg?.enabled) {
    result.error = 'Screenshots are switched off (SHOT_ENABLED=false).';
    return result;
  }
  if (!url) {
    result.error = 'No page URL to render.';
    return result;
  }

  // Leave a little headroom so a slow render never eats the whole step budget.
  const budgetMs = Math.max(
    4000,
    deadline
      ? Math.min(cfg.timeout * 1000, (deadline - Date.now() / 1000) * 1000 - 1500)
      : cfg.timeout * 1000,
  );

  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    result.error = 'playwright-core is not installed on this host.';
    return result;
  }

  // playwright-core resolves the browser @playwright/browser-chromium installed
  // into the shared cache. The env var is the escape hatch for images that ship
  // a system Chromium instead.
  const executablePath = process.env.CHROMIUM_PATH || undefined;

  const dir = storagePath('shots');
  fs.mkdirSync(dir, { recursive: true });

  let browser: import('playwright-core').Browser | null = null;

  try {
    browser = await chromium.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
      timeout: Math.min(budgetMs, 10000),
    });

    const ua = String(config('crawl.user_agent', ''));
    const ctx = await browser.newContext({
      viewport: { width: cfg.desktop_width, height: cfg.desktop_height },
      deviceScaleFactor: 1,
      userAgent: ua || undefined,
      // The audit reads public pages only; never carry credentials in.
      javaScriptEnabled: true,
      bypassCSP: false,
      reducedMotion: 'reduce',
    });
    ctx.setDefaultTimeout(budgetMs);

    const page = await ctx.newPage();
    // Block nothing: a blocked asset would change what the client sees.
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(budgetMs, 12000),
    });

    // Give late-loading heroes a moment without waiting for analytics beacons.
    await page
      .waitForLoadState('networkidle', { timeout: 3500 })
      .catch(() => undefined);

    const measured = (await page.evaluate(collectBoxes, cfg.desktop_height)) as {
      boxes: ShotBox[];
      pageHeight: number;
      background: string;
    };

    result.boxes = measured.boxes ?? [];
    result.page_height = measured.pageHeight ?? cfg.desktop_height;
    result.background = measured.background ?? '';
    result.fold_height = cfg.desktop_height;
    result.fold_ratio =
      result.page_height > 0
        ? Math.min(1, cfg.desktop_height / result.page_height)
        : 1;

    const write = async (
      variant: ShotFrame['variant'],
      buf: Buffer,
      width: number,
      height: number,
    ): Promise<void> => {
      const file = shotPath(auditId, variant);
      await fs.promises.writeFile(file, buf);
      result.frames[variant] = {
        variant,
        file: path.basename(file),
        width,
        height,
        bytes: buf.byteLength,
      };
    };

    // 1. Desktop fold — the frame every "above the fold" finding refers to.
    await write(
      'desktop',
      await page.screenshot({ type: 'jpeg', quality: cfg.quality }),
      cfg.desktop_width,
      cfg.desktop_height,
    );

    // 2. Full desktop page, capped so a 30k-pixel page cannot blow up memory.
    //
    // `clip` on its own is bounded by the viewport, and `fullPage` ignores the
    // cap — so grow the viewport to the capped height and take a normal shot.
    const fullHeight = Math.min(result.page_height, cfg.max_full_height);
    if (fullHeight > cfg.desktop_height) {
      await page.setViewportSize({
        width: cfg.desktop_width,
        height: fullHeight,
      });
      await page.waitForTimeout(350); // let lazy content settle into place
    }
    await write(
      'desktop-full',
      await page.screenshot({ type: 'jpeg', quality: cfg.quality }),
      cfg.desktop_width,
      fullHeight,
    );

    // 3. Mobile fold — most fintech paid traffic lands here.
    await page.setViewportSize({
      width: cfg.mobile_width,
      height: cfg.mobile_height,
    });
    await page.waitForTimeout(450); // let responsive breakpoints settle
    await write(
      'mobile',
      await page.screenshot({ type: 'jpeg', quality: cfg.quality }),
      cfg.mobile_width,
      cfg.mobile_height,
    );

    result.ok = Object.keys(result.frames).length > 0;
    result.captured_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await ctx.close();
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    await browser?.close().catch(() => undefined);
  }

  return result;
}

/** Delete frames for one audit (used when an audit is discarded). */
export function purge(auditId: string): void {
  for (const variant of ['desktop', 'desktop-full', 'mobile']) {
    try {
      fs.unlinkSync(shotPath(auditId, variant));
    } catch {
      // already gone
    }
  }
}

export default { capture, shotPath, purge };
