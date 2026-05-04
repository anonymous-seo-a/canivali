import { type Browser, type BrowserContext, chromium } from 'playwright';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { extractArticle, type ExtractedArticle } from './extract.js';

export type CrawlResult =
  | { ok: true; article: ExtractedArticle; httpStatus: number }
  | { ok: false; error: string; httpStatus: number | null };

let _browser: Browser | null = null;
let _ctx: BrowserContext | null = null;

export async function getCrawlContext(): Promise<BrowserContext> {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }
  if (!_ctx) {
    _ctx = await _browser.newContext({
      userAgent: env.USER_AGENT_FOR_CRAWL,
      viewport: { width: 1280, height: 800 },
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });
    _ctx.setDefaultTimeout(env.CRAWL_TIMEOUT_MS);
  }
  return _ctx;
}

export async function closeCrawlContext(): Promise<void> {
  if (_ctx) await _ctx.close();
  if (_browser) await _browser.close();
  _ctx = null;
  _browser = null;
}

export async function crawlUrl(url: string): Promise<CrawlResult> {
  const ctx = await getCrawlContext();
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: env.CRAWL_TIMEOUT_MS });
    const status = resp?.status() ?? null;
    if (!resp || !resp.ok()) {
      return { ok: false, error: `non-ok response`, httpStatus: status };
    }
    // give late JS-loaded text a brief moment
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    const html = await page.content();
    const article = extractArticle(html);
    return { ok: true, article, httpStatus: status ?? 200 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ url, err: msg }, 'crawl error');
    return { ok: false, error: msg, httpStatus: null };
  } finally {
    await page.close().catch(() => {});
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
