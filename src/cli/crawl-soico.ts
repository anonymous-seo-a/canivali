/**
 * 434件の article inventory CSV を読み、
 *   1) master_articles に upsert (タイトル/URL/quarantine)
 *   2) Playwright で本文取得して body_text / body_hash 等を更新
 *
 * 使い方:
 *   npm run crawl:soico                # 全件
 *   npm run crawl:soico -- --limit=5   # 先頭 N 件のみ (smoke test)
 *   npm run crawl:soico -- --id=11077  # 単発
 *   npm run crawl:soico -- --upsert-only  # 本文取得せず CSV 反映のみ
 *   npm run crawl:soico -- --skip-quarantined  # 確定汚染はクロールしない
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { closeCrawlContext, crawlUrl, sleep } from '../ingestion/crawl.js';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

type CsvRow = {
  id: number;
  url: string;
  title: string;
  category_quarantine: string;
  quarantine_reason: string;
};

// 厳密な CSV パーサ (RFC4180 風: ダブルクオート + 内側のエスケープ)
function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(cur);
        cur = '';
      } else if (c === '\n') {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else if (c === '\r') {
        // skip
      } else {
        cur += c;
      }
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }

  const [header, ...data] = rows;
  if (!header) return [];
  const idx = (k: string) => header.indexOf(k);
  const iId = idx('id');
  const iUrl = idx('url');
  const iTitle = idx('title');
  const iQ = idx('category_quarantine');
  const iR = idx('quarantine_reason');

  return data
    .filter((r) => r.length >= 3 && r[iId])
    .map((r) => ({
      id: Number(r[iId]),
      url: r[iUrl] ?? '',
      title: r[iTitle] ?? '',
      category_quarantine: (r[iQ] ?? 'in_scope') || 'in_scope',
      quarantine_reason: r[iR] ?? '',
    }));
}

function upsertArticles(db: Database.Database, rows: CsvRow[]): { inserted: number; updated: number } {
  const stmt = db.prepare(`
    INSERT INTO master_articles
      (article_id, url, title, category_quarantine, quarantine_reason)
    VALUES (@id, @url, @title, @category_quarantine, @quarantine_reason)
    ON CONFLICT(article_id) DO UPDATE SET
      url                 = excluded.url,
      title               = excluded.title,
      category_quarantine = excluded.category_quarantine,
      quarantine_reason   = excluded.quarantine_reason,
      updated_at          = strftime('%s','now')
  `);
  const tx = db.transaction((items: CsvRow[]) => {
    let inserted = 0;
    let updated = 0;
    for (const r of items) {
      const before = db.prepare('SELECT article_id FROM master_articles WHERE article_id = ?').get(r.id);
      stmt.run(r);
      if (before) updated++;
      else inserted++;
    }
    return { inserted, updated };
  });
  return tx(rows);
}

async function crawlAndUpdate(db: Database.Database, rows: CsvRow[], opts: { skipQuarantined: boolean }) {
  const update = db.prepare(`
    UPDATE master_articles SET
      body_text       = @body_text,
      body_hash       = @body_hash,
      word_count      = @word_count,
      publish_date    = @publish_date,
      last_modified   = @last_modified,
      crawled_at      = @crawled_at,
      status          = @status,
      updated_at      = strftime('%s','now')
    WHERE article_id = @article_id
  `);

  let ok = 0;
  let fail = 0;
  let i = 0;
  for (const r of rows) {
    i++;
    if (opts.skipQuarantined && r.category_quarantine === 'confirmed') {
      logger.info({ id: r.id }, `[${i}/${rows.length}] skip (confirmed quarantine)`);
      continue;
    }

    const result = await crawlUrl(r.url);
    if (!result.ok) {
      fail++;
      logger.warn({ id: r.id, status: result.httpStatus }, `[${i}/${rows.length}] fail: ${result.error}`);
      update.run({
        article_id: r.id,
        body_text: null,
        body_hash: null,
        word_count: null,
        publish_date: null,
        last_modified: null,
        crawled_at: Math.floor(Date.now() / 1000),
        status: result.httpStatus === 404 ? 'deleted' : 'published',
      });
    } else {
      ok++;
      const a = result.article;
      update.run({
        article_id: r.id,
        body_text: a.body_text,
        body_hash: a.body_hash,
        word_count: a.word_count,
        publish_date: a.publish_date,
        last_modified: a.last_modified,
        crawled_at: Math.floor(Date.now() / 1000),
        status: 'published',
      });
      if (i % 25 === 0) {
        logger.info({ id: r.id, ok, fail }, `[${i}/${rows.length}] progress`);
      }
    }

    await sleep(env.CRAWL_DELAY_MS);
  }
  return { ok, fail };
}

function parseArgs(argv: string[]): { limit: number | null; id: number | null; upsertOnly: boolean; skipQuarantined: boolean } {
  let limit: number | null = null;
  let id: number | null = null;
  let upsertOnly = false;
  let skipQuarantined = false;
  for (const a of argv) {
    if (a.startsWith('--limit=')) limit = Number(a.split('=')[1]);
    else if (a.startsWith('--id=')) id = Number(a.split('=')[1]);
    else if (a === '--upsert-only') upsertOnly = true;
    else if (a === '--skip-quarantined') skipQuarantined = true;
  }
  return { limit, id, upsertOnly, skipQuarantined };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = resolve('docs/strategic/article_inventory_initial.csv');
  const text = readFileSync(csvPath, 'utf8');
  let rows = parseCsv(text);
  logger.info({ total: rows.length }, 'csv loaded');

  if (args.id !== null) rows = rows.filter((r) => r.id === args.id);
  if (args.limit !== null) rows = rows.slice(0, args.limit);

  const db = getDb();
  const { inserted, updated } = upsertArticles(db, rows);
  logger.info({ inserted, updated }, 'upsert complete');
  recordAudit(db, {
    entityType: 'master_articles',
    entityId: 'bulk',
    action: 'create',
    after: { inserted, updated, source: 'article_inventory_initial.csv' },
    actor: 'cli:crawl-soico',
    reason: 'initial inventory load',
  });

  if (args.upsertOnly) {
    closeDb();
    return;
  }

  const stats = await crawlAndUpdate(db, rows, { skipQuarantined: args.skipQuarantined });
  logger.info(stats, 'crawl complete');

  await closeCrawlContext();
  closeDb();
}

main().catch((e) => {
  logger.error(e, 'fatal');
  process.exit(1);
});
