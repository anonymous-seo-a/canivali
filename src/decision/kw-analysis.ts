/**
 * 1. 各記事の top KW (clicks 順) を master_articles.top_queries_json にキャッシュ
 * 2. 各カニバリペアに対し top KW 集合 (impressions >= MIN_IMP かつ top K 内) の
 *    jaccard 類似度 + 共通 KW 件数を計算して cannibalization_pairs に保存
 *
 * 統合判定ゲート:
 *   - jaccard >= JACCARD_HIGH (例 0.5): 強い意図一致 → CONSOLIDATE OK
 *   - JACCARD_LOW <= jaccard < JACCARD_HIGH: 部分一致 → DIFFERENTIATE 推奨
 *   - jaccard < JACCARD_LOW (例 0.15): 意図違い → CONSOLIDATE 拒否
 *
 * 使い方:
 *   npm run decide:kw-analysis
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';

const TOP_K = 10;
const MIN_IMPRESSIONS = 5;
const WINDOW_DAYS = 90;

type Q = { query: string; clicks: number; impressions: number; avg_position: number };

function loadTopQueries(db: ReturnType<typeof getDb>, articleId: number): Q[] {
  return db
    .prepare(
      `SELECT query,
              SUM(clicks) AS clicks,
              SUM(impressions) AS impressions,
              SUM(impressions * avg_position) / NULLIF(SUM(impressions),0) AS avg_position
         FROM gsc_query_url_snapshots
        WHERE article_id = ? AND window_days = ?
        GROUP BY query
       HAVING SUM(impressions) >= ?
        ORDER BY clicks DESC, impressions DESC
        LIMIT ?`,
    )
    .all(articleId, WINDOW_DAYS, MIN_IMPRESSIONS, TOP_K) as Q[];
}

function jaccardSets(a: Set<string>, b: Set<string>): { jaccard: number; both: number; aOnly: number; bOnly: number } {
  let both = 0;
  for (const k of a) if (b.has(k)) both++;
  const aOnly = a.size - both;
  const bOnly = b.size - both;
  const union = a.size + b.size - both;
  const jaccard = union > 0 ? both / union : 0;
  return { jaccard, both, aOnly, bOnly };
}

function main() {
  const db = getDb();

  // ----- 1) 各記事に top_queries_json を保存 -----
  const articles = db
    .prepare(
      `SELECT article_id FROM master_articles
        WHERE category_quarantine != 'confirmed'`,
    )
    .all() as Array<{ article_id: number }>;

  const updateArticle = db.prepare(
    `UPDATE master_articles SET
       top_queries_json = ?,
       top_queries_updated_at = strftime('%s','now')
     WHERE article_id = ?`,
  );

  const cache = new Map<number, Q[]>();
  const tx1 = db.transaction(() => {
    for (const a of articles) {
      const qs = loadTopQueries(db, a.article_id);
      cache.set(a.article_id, qs);
      updateArticle.run(JSON.stringify(qs), a.article_id);
    }
  });
  tx1();
  logger.info({ articles: articles.length }, 'top_queries cached');

  // ----- 2) 各ペアに jaccard を計算 -----
  const pairs = db
    .prepare(
      `SELECT pair_id, article_a_id, article_b_id FROM cannibalization_pairs`,
    )
    .all() as Array<{ pair_id: number; article_a_id: number; article_b_id: number }>;

  const updatePair = db.prepare(
    `UPDATE cannibalization_pairs SET
       kw_jaccard       = ?,
       kw_overlap_count = ?,
       kw_a_only_count  = ?,
       kw_b_only_count  = ?
     WHERE pair_id = ?`,
  );

  // 分布統計
  const buckets = new Map<string, number>();
  const tx2 = db.transaction(() => {
    for (const p of pairs) {
      const aQ = cache.get(p.article_a_id) ?? loadTopQueries(db, p.article_a_id);
      const bQ = cache.get(p.article_b_id) ?? loadTopQueries(db, p.article_b_id);
      const aSet = new Set(aQ.map((q) => q.query));
      const bSet = new Set(bQ.map((q) => q.query));
      const r = jaccardSets(aSet, bSet);
      updatePair.run(r.jaccard, r.both, r.aOnly, r.bOnly, p.pair_id);

      const bucket =
        r.jaccard >= 0.5 ? '0.5+'
        : r.jaccard >= 0.3 ? '0.3-0.5'
        : r.jaccard >= 0.15 ? '0.15-0.3'
        : r.jaccard > 0    ? '0-0.15'
        : '0';
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
  });
  tx2();

  console.log('=== kw_jaccard distribution (全 cannibalization_pairs) ===');
  for (const [k, v] of [...buckets.entries()].sort((x, y) => y[0].localeCompare(x[0]))) {
    console.log(`  ${k.padEnd(10)} ${v}`);
  }

  // CONSOLIDATE 候補での jaccard 分布も
  const consBuckets = db
    .prepare(
      `SELECT
         CASE
           WHEN cp.kw_jaccard >= 0.5  THEN '0.5+'
           WHEN cp.kw_jaccard >= 0.3  THEN '0.3-0.5'
           WHEN cp.kw_jaccard >= 0.15 THEN '0.15-0.3'
           WHEN cp.kw_jaccard >  0    THEN '0-0.15'
           ELSE '0'
         END AS bucket,
         COUNT(*) AS c
       FROM cannibalization_pairs cp
       JOIN decision_log dl ON dl.pair_id = cp.pair_id
       WHERE dl.action='CONSOLIDATE'
       GROUP BY bucket`,
    )
    .all() as Array<{ bucket: string; c: number }>;
  console.log('\n=== kw_jaccard 分布 (action=CONSOLIDATE のみ) ===');
  for (const b of consBuckets) console.log(`  ${b.bucket.padEnd(10)} ${b.c}`);

  recordAudit(db, {
    entityType: 'cannibalization_pairs',
    entityId: 'kw_analysis',
    action: 'update',
    after: { articles: articles.length, pairs: pairs.length, distribution: Object.fromEntries(buckets) },
    actor: 'cli:kw-analysis',
    reason: 'Phase 5 Step 1 — top KW + jaccard',
  });

  closeDb();
}

main();
