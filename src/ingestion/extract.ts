import { type CheerioAPI, load } from 'cheerio';
import { createHash } from 'node:crypto';

export type ExtractedArticle = {
  title: string;
  body_text: string;
  body_hash: string;
  word_count: number;
  publish_date: string | null;
  last_modified: string | null;
};

function pickDate($: CheerioAPI, selectors: string[]): string | null {
  for (const sel of selectors) {
    const v = $(sel).attr('content') ?? $(sel).text();
    if (v) {
      const d = v.trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    }
  }
  return null;
}

export function extractArticle(html: string): ExtractedArticle {
  const $ = load(html);

  $('script,style,noscript,svg,iframe').remove();

  const title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().trim();

  // soico の本文は article > .post-content 系。優先順を試行。
  const candidates = [
    'article .post-content',
    'article .entry-content',
    'article',
    'main .post-content',
    'main',
    '.post-content',
    '.entry-content',
  ];
  let body_text = '';
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length) {
      const t = el.text().replace(/\s+/g, ' ').trim();
      if (t.length > body_text.length) body_text = t;
    }
  }
  if (!body_text) body_text = $('body').text().replace(/\s+/g, ' ').trim();

  const body_hash = createHash('sha256').update(body_text).digest('hex');
  const word_count = body_text.length;

  const publish_date = pickDate($, [
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'time[itemprop="datePublished"]',
    'time[datetime]',
  ]);
  const last_modified = pickDate($, [
    'meta[property="article:modified_time"]',
    'meta[name="lastmod"]',
    'time[itemprop="dateModified"]',
  ]);

  return { title, body_text, body_hash, word_count, publish_date, last_modified };
}
