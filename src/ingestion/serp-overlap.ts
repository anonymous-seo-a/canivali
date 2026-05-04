/**
 * カニバリ候補ペア (cosine 高) の SERP 重複度を SerpAPI で測定する。
 *
 * フロー:
 *   1. cannibalization_pairs から severity='high' (cosine ≥ 0.9) を上位 N 件取り出す
 *   2. 各ペア (A, B) について GSC で「両方が出現するクエリ」 (shared queries) を探す
 *   3. shared queries が存在するペアのみ SerpAPI を叩く (コスト最小化)
 *   4. 各 shared query で SerpAPI の organic top 10 URL を取り、
 *      A の URL と B の URL がどちらも top 10 に出現する割合 = serp_overlap_pct を更新
 *
 * 使い方:
 *   npm run pull:serp-overlap                # 上位 200 ペア
 *   npm run pull:serp-overlap -- --limit=50  # コスト管理
 *   npm run pull:serp-overlap -- --dry-run   # API 叩かず候補数を表示
 */
import type Database from 'better-sqlite3';
import { fetch } from 'undici';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

const DEFAULT_LIMIT = 200;
const MAX_QUERIES_PER_PAIR = 5; // 1ペアあたり最大5クエリで概算

type Pair = {
  pair_id: number;
  article_a_id: number;
  article_b_id: number;
  cosine_similarity: number;
};

function findSharedQueries(
  db: Database.Database,
  aId: number,
  bId: number,
  minImpressions = 5,
): Array<{ query: string; a_imp: number; b_imp: number; a_pos: number; b_pos: number }> {
  return db
    .prepare(
      `WITH a AS (
         SELECT query,
                SUM(impressions) AS imp,
                SUM(impressions * avg_position) / NULLIF(SUM(impressions),0) AS pos
           FROM gsc_query_url_snapshots
          WHERE article_id = ?
          GROUP BY query
       ),
       b AS (
         SELECT query,
                SUM(impressions) AS imp,
                SUM(impressions * avg_position) / NULLIF(SUM(impressions),0) AS pos
           FROM gsc_query_url_snapshots
          WHERE article_id = ?
          GROUP BY query
       )
       SELECT a.query AS query, a.imp AS a_imp, b.imp AS b_imp, a.pos AS a_pos, b.pos AS b_pos
         FROM a JOIN b ON a.query = b.query
        WHERE a.imp >= ? AND b.imp >= ?
        ORDER BY (a.imp + b.imp) DESC
        LIMIT ?`,
    )
    .all(aId, bId, minImpressions, minImpressions, MAX_QUERIES_PER_PAIR) as Array<{
    query: string;
    a_imp: number;
    b_imp: number;
    a_pos: number;
    b_pos: number;
  }>;
}

async function fetchSerpTopUrls(query: string): Promise<string[]> {
  if (!env.SERPAPI_KEY) throw new Error('SERPAPI_KEY missing');
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'ja');
  url.searchParams.set('gl', 'jp');
  url.searchParams.set('google_domain', 'google.co.jp');
  url.searchParams.set('num', '10');
  url.searchParams.set('api_key', env.SERPAPI_KEY);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = (await res.json()) as { organic_results?: Array<{ link?: string }> };
  return (data.organic_results ?? []).map((r) => r.link ?? '').filter(Boolean).slice(0, 10);
}

function parseArgs(argv: string[]): { limit: number; dryRun: boolean; minSeverity: 'high' | 'medium' } {
  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  let minSeverity: 'high' | 'medium' = 'high';
  for (const a of argv) {
    if (a.startsWith('--limit=')) limit = Number(a.split('=')[1]);
    if (a === '--dry-run') dryRun = true;
    if (a === '--include-medium') minSeverity = 'medium';
  }
  return { limit, dryRun, minSeverity };
}

async function main() {
  const { limit, dryRun, minSeverity } = parseArgs(process.argv.slice(2));
  const db = getDb();

  const sevFilter = minSeverity === 'high' ? `severity = 'high'` : `severity IN ('high','medium')`;
  const pairs = db
    .prepare(
      `SELECT pair_id, article_a_id, article_b_id, cosine_similarity
         FROM cannibalization_pairs
        WHERE ${sevFilter}
        ORDER BY cosine_similarity DESC
        LIMIT ?`,
    )
    .all(limit) as Pair[];

  logger.info({ pairs: pairs.length, dryRun, minSeverity }, 'serp-overlap begin');

  // 各ペアの shared queries を計算
  const candidates: Array<{ pair: Pair; shared: ReturnType<typeof findSharedQueries> }> = [];
  for (const p of pairs) {
    const shared = findSharedQueries(db, p.article_a_id, p.article_b_id);
    if (shared.length > 0) candidates.push({ pair: p, shared });
  }
  logger.info(
    { candidates: candidates.length, no_shared: pairs.length - candidates.length },
    'pairs with shared queries',
  );

  if (dryRun) {
    console.log('=== dry-run ===');
    console.log(`pairs:               ${pairs.length}`);
    console.log(`with shared queries: ${candidates.length}`);
    console.log(`max SERP calls:      ${candidates.reduce((s, c) => s + c.shared.length, 0)}`);
    closeDb();
    return;
  }

  // 各ペアの URL は固定 (master_articles から取る)
  const urlOf = new Map<number, string>();
  for (const r of db.prepare('SELECT article_id, url FROM master_articles').all() as Array<{
    article_id: number;
    url: string;
  }>) {
    urlOf.set(r.article_id, r.url);
  }

  const update = db.prepare(`
    UPDATE cannibalization_pairs SET
      serp_overlap_pct      = ?,
      shared_queries_count  = ?,
      shared_queries_json   = ?
    WHERE pair_id = ?
  `);

  let serpCalls = 0;
  let updated = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { pair, shared } = candidates[i]!;
    const aUrl = urlOf.get(pair.article_a_id);
    const bUrl = urlOf.get(pair.article_b_id);
    if (!aUrl || !bUrl) continue;

    let bothInTop = 0;
    const detail: Array<{ query: string; a_in: boolean; b_in: boolean }> = [];

    for (const sh of shared) {
      try {
        const urls = await fetchSerpTopUrls(sh.query);
        serpCalls++;
        const aIn = urls.some((u) => u.includes(aUrl) || aUrl.includes(u));
        const bIn = urls.some((u) => u.includes(bUrl) || bUrl.includes(u));
        if (aIn && bIn) bothInTop++;
        detail.push({ query: sh.query, a_in: aIn, b_in: bIn });
      } catch (e) {
        logger.warn(
          { query: sh.query, err: e instanceof Error ? e.message : String(e) },
          'serp fetch error',
        );
      }
    }
    const overlapPct = shared.length > 0 ? bothInTop / shared.length : 0;
    update.run(overlapPct, shared.length, JSON.stringify(detail), pair.pair_id);
    updated++;

    if ((i + 1) % 10 === 0 || i + 1 === candidates.length) {
      logger.info(
        { progress: `${i + 1}/${candidates.length}`, serp_calls: serpCalls, updated },
        'progress',
      );
    }
  }

  recordAudit(db, {
    entityType: 'cannibalization_pairs',
    entityId: 'serp_overlap',
    action: 'update',
    after: { pairs_evaluated: candidates.length, serp_calls: serpCalls, updated },
    actor: 'cli:serp-overlap',
    reason: 'Phase 2 Step 8',
  });

  // 最終分布
  const dist = db
    .prepare(
      `SELECT
         CASE
           WHEN serp_overlap_pct >= 0.8 THEN '0.8+'
           WHEN serp_overlap_pct >= 0.5 THEN '0.5-0.8'
           WHEN serp_overlap_pct >= 0.2 THEN '0.2-0.5'
           WHEN serp_overlap_pct >  0   THEN '0-0.2'
           ELSE '0'
         END AS bucket,
         COUNT(*) AS c
       FROM cannibalization_pairs
       WHERE serp_overlap_pct IS NOT NULL
       GROUP BY bucket
       ORDER BY bucket DESC`,
    )
    .all() as Array<{ bucket: string; c: number }>;

  console.log('=== serp_overlap_pct distribution ===');
  for (const d of dist) console.log(`  ${d.bucket.padEnd(10)} ${d.c}`);
  console.log(`\ntotal SerpAPI calls: ${serpCalls}`);
  closeDb();
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, 'fatal');
  process.exit(1);
});
