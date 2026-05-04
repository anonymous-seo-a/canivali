/**
 * Search Console から (query, page) ディメンションのパフォーマンスを取得し、
 * 1) gsc_query_url_snapshots に query × url の生データを格納
 * 2) article_performance_snapshots に URL 単位の集計を格納
 *
 * 仕様:
 *   - 対象 URL: master_articles.url のみ (cardloan/ 配下)
 *   - window: 既定で 90 日 (--window=180 等で変更)
 *   - GSC は最新データに 2-3 日の遅延があるため endDate = 3日前
 *   - rowLimit 25,000 を pageToken でページング
 *
 * 使い方:
 *   npm run pull:gsc                 # 90日窓
 *   npm run pull:gsc -- --window=180
 *   npm run pull:gsc -- --window=365
 *   npm run pull:gsc -- --dry-run    # 実行せず件数だけ見る
 */
import type Database from 'better-sqlite3';
import { google } from 'googleapis';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

const GSC_DELAY_DAYS = 3;
const ROW_LIMIT = 25_000;

type Row = {
  keys: string[]; // [query, page]
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function* iterateGsc(opts: {
  property: string;
  startDate: string;
  endDate: string;
}): AsyncGenerator<Row[]> {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const wm = google.webmasters({ version: 'v3', auth });

  let startRow = 0;
  while (true) {
    const res = await wm.searchanalytics.query({
      siteUrl: opts.property,
      requestBody: {
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: ['query', 'page'],
        rowLimit: ROW_LIMIT,
        startRow,
        type: 'web',
      },
    });
    const rows = (res.data.rows ?? []) as Row[];
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < ROW_LIMIT) return;
    startRow += rows.length;
  }
}

function buildUrlIndex(db: Database.Database): Map<string, number> {
  const rows = db.prepare('SELECT article_id, url FROM master_articles').all() as Array<{
    article_id: number;
    url: string;
  }>;
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.url, r.article_id);
    // 末尾スラッシュ違いを許容
    if (r.url.endsWith('/')) m.set(r.url.slice(0, -1), r.article_id);
    else m.set(`${r.url}/`, r.article_id);
  }
  return m;
}

function parseArgs(argv: string[]): { window: number; dryRun: boolean } {
  let windowDays = 90;
  let dryRun = false;
  for (const a of argv) {
    if (a.startsWith('--window=')) windowDays = Number(a.split('=')[1]);
    if (a === '--dry-run') dryRun = true;
  }
  return { window: windowDays, dryRun };
}

async function main() {
  const { window: windowDays, dryRun } = parseArgs(process.argv.slice(2));
  if (!env.GSC_PROPERTY_URL) {
    throw new Error('GSC_PROPERTY_URL is not set');
  }

  const today = new Date();
  const endDate = new Date(today);
  endDate.setUTCDate(today.getUTCDate() - GSC_DELAY_DAYS);
  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - windowDays + 1);
  const startStr = ymd(startDate);
  const endStr = ymd(endDate);
  const snapshotDate = endStr;

  logger.info(
    { property: env.GSC_PROPERTY_URL, startDate: startStr, endDate: endStr, windowDays, dryRun },
    'gsc pull begin',
  );

  const db = getDb();
  const urlIndex = buildUrlIndex(db);

  const insSnapshot = db.prepare(`
    INSERT INTO gsc_query_url_snapshots
      (article_id, query, snapshot_date, window_days, clicks, impressions, ctr, avg_position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 既存データ (同じ window/snapshot_date) を消してから入れる (再実行可能性)
  if (!dryRun) {
    const del = db
      .prepare(
        'DELETE FROM gsc_query_url_snapshots WHERE snapshot_date = ? AND window_days = ?',
      )
      .run(snapshotDate, windowDays);
    logger.info({ deleted: del.changes }, 'cleared existing snapshots for this window');
  }

  let totalRows = 0;
  let matched = 0;
  let unmatched = 0;
  const perArticle = new Map<
    number,
    { clicks: number; impressions: number; ctr_num: number; pos_num: number; n: number }
  >();

  for await (const batch of iterateGsc({
    property: env.GSC_PROPERTY_URL,
    startDate: startStr,
    endDate: endStr,
  })) {
    totalRows += batch.length;
    const tx = db.transaction((items: Row[]) => {
      for (const r of items) {
        const [query, page] = r.keys;
        if (!query || !page) continue;
        const articleId = urlIndex.get(page) ?? null;
        if (articleId === null) {
          unmatched++;
          continue;
        }
        matched++;
        if (!dryRun) {
          insSnapshot.run(
            articleId,
            query,
            snapshotDate,
            windowDays,
            r.clicks ?? 0,
            r.impressions ?? 0,
            r.ctr ?? 0,
            r.position ?? 0,
          );
        }
        const agg = perArticle.get(articleId) ?? {
          clicks: 0,
          impressions: 0,
          ctr_num: 0,
          pos_num: 0,
          n: 0,
        };
        agg.clicks += r.clicks ?? 0;
        agg.impressions += r.impressions ?? 0;
        agg.ctr_num += (r.ctr ?? 0) * (r.impressions ?? 0);
        agg.pos_num += (r.position ?? 0) * (r.impressions ?? 0);
        agg.n += 1;
        perArticle.set(articleId, agg);
      }
    });
    tx(batch);
    logger.info({ totalRows, matched, unmatched }, 'batch ingested');
  }

  // article 集計
  if (!dryRun) {
    const insPerf = db.prepare(`
      INSERT INTO article_performance_snapshots
        (article_id, snapshot_date, window_days, clicks, impressions, ctr, avg_position)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_id, snapshot_date, window_days) DO UPDATE SET
        clicks       = excluded.clicks,
        impressions  = excluded.impressions,
        ctr          = excluded.ctr,
        avg_position = excluded.avg_position
    `);
    const tx = db.transaction(() => {
      for (const [articleId, agg] of perArticle) {
        const ctr = agg.impressions > 0 ? agg.ctr_num / agg.impressions : 0;
        const pos = agg.impressions > 0 ? agg.pos_num / agg.impressions : 0;
        insPerf.run(
          articleId,
          snapshotDate,
          windowDays,
          agg.clicks,
          agg.impressions,
          ctr,
          pos,
        );
      }
    });
    tx();
  }

  recordAudit(db, {
    entityType: 'gsc_query_url_snapshots',
    entityId: `window=${windowDays}_${snapshotDate}`,
    action: 'create',
    after: {
      totalRows,
      matched,
      unmatched,
      articles: perArticle.size,
      property: env.GSC_PROPERTY_URL,
      startDate: startStr,
      endDate: endStr,
    },
    actor: 'cli:gsc-pull',
    reason: 'Phase 2 Step 7',
  });

  console.log('=== gsc-pull summary ===');
  console.log(`property:      ${env.GSC_PROPERTY_URL}`);
  console.log(`window:        ${windowDays} days  [${startStr} → ${endStr}]`);
  console.log(`rows received: ${totalRows}`);
  console.log(`matched:       ${matched}`);
  console.log(`unmatched URL: ${unmatched} (not in master_articles)`);
  console.log(`articles touched: ${perArticle.size}`);
  if (dryRun) console.log('(dry-run: no DB writes)');

  closeDb();
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, 'fatal');
  process.exit(1);
});
