/**
 * Decision Engine をバルク実行し、decision_log に結果を投入する。
 *
 * 入力:
 *   - master_articles (全 in_scope)
 *   - cannibalization_pairs (severity high + medium)
 *   - article_performance_snapshots (window 90 を優先)
 *
 * 出力: decision_log (article_id 単独 or pair_id 単独で1レコード)
 *
 * 既存の decision_log で human_reviewed=0 のものは clear して再投入。
 * human_reviewed=1 のものは保持 (人間判断は上書きしない)。
 */
import type Database from 'better-sqlite3';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import {
  type ArticleMetrics,
  type Decision,
  decideArticle,
  decidePair,
  selectWinner,
  type PairMetrics,
} from './engine.js';
import type { PairRelation } from './cell-relation.js';
import { type NormalizableDecision, normalizeGraph } from './graph-normalize.js';

const PERF_WINDOW_DAYS = 90;

function getArticleMetrics(db: Database.Database, articleId: number): ArticleMetrics | null {
  const row = db
    .prepare(
      `SELECT a.article_id, a.url, a.title, a.business_relevance_score,
              a.classification_confidence, a.subtopic_topic_id, a.vocabulary_topic_id,
              a.category_quarantine,
              COALESCE(p.clicks, 0)        AS clicks,
              COALESCE(p.impressions, 0)   AS impressions,
              COALESCE(p.ctr, 0)           AS ctr,
              COALESCE(p.avg_position, 0)  AS avg_position,
              COALESCE(a.internal_links_in, 0)        AS internal_links_in,
              COALESCE(a.unique_brands_count, 0)      AS unique_brands_count,
              COALESCE(a.total_brand_mentions, 0)     AS total_brand_mentions,
              COALESCE(a.url_quality_score, 0)        AS url_quality_score,
              COALESCE(a.freshness_score, 0)          AS freshness_score,
              COALESCE(a.consolidate_winner_count, 0) AS consolidate_winner_count
         FROM master_articles a
    LEFT JOIN article_performance_snapshots p
           ON p.article_id = a.article_id AND p.window_days = ?
        WHERE a.article_id = ?`,
    )
    .get(PERF_WINDOW_DAYS, articleId) as ArticleMetrics | undefined;
  return row ?? null;
}

function buildPairMetrics(
  db: Database.Database,
  pair: {
    pair_id: number;
    article_a_id: number;
    article_b_id: number;
    cosine_similarity: number;
    serp_overlap_pct: number | null;
    shared_queries_count: number | null;
    pair_relation: PairRelation | null;
    kw_jaccard: number | null;
    kw_overlap_count: number | null;
  },
): PairMetrics | null {
  const a = getArticleMetrics(db, pair.article_a_id);
  const b = getArticleMetrics(db, pair.article_b_id);
  if (!a || !b) return null;
  return {
    pair_id: pair.pair_id,
    cosine_similarity: pair.cosine_similarity,
    serp_overlap_pct: pair.serp_overlap_pct,
    shared_queries_count: pair.shared_queries_count,
    pair_relation: pair.pair_relation,
    kw_jaccard: pair.kw_jaccard,
    kw_overlap_count: pair.kw_overlap_count,
    a,
    b,
  };
}

function insertDecision(
  db: Database.Database,
  args: {
    article_id?: number;
    pair_id?: number;
    decision: Decision;
  },
): void {
  db.prepare(
    `INSERT INTO decision_log
       (article_id, pair_id, action, target_url, target_subtopic_id, target_vocabulary_id,
        confidence_score, rationale_json, human_reviewed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    args.article_id ?? null,
    args.pair_id ?? null,
    args.decision.action,
    args.decision.target_url ?? null,
    args.decision.target_subtopic_id ?? null,
    args.decision.target_vocabulary_id ?? null,
    args.decision.confidence,
    JSON.stringify(args.decision.rationale),
  );
}

function main() {
  const db = getDb();

  // human_reviewed=0 のレコードを削除して再生成
  const del = db.prepare('DELETE FROM decision_log WHERE human_reviewed = 0').run();
  logger.info({ deleted: del.changes }, 'cleared unreviewed decisions');

  // ----- 1) 単独記事評価 (in_scope のみ; confirmed は別途扱う必要があれば追加) -----
  const articleIds = db
    .prepare("SELECT article_id FROM master_articles ORDER BY article_id")
    .all() as Array<{ article_id: number }>;

  const articleHist = new Map<string, number>();
  let articleDecisions = 0;
  for (const { article_id } of articleIds) {
    const m = getArticleMetrics(db, article_id);
    if (!m) continue;
    const d = decideArticle(m);
    insertDecision(db, { article_id, decision: d });
    articleHist.set(d.action, (articleHist.get(d.action) ?? 0) + 1);
    articleDecisions++;
  }
  console.log('=== article-level decisions ===');
  for (const [k, v] of [...articleHist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }

  // ----- 2) ペア評価 (severity high + medium のみ) -----
  const pairs = db
    .prepare(
      `SELECT pair_id, article_a_id, article_b_id, cosine_similarity,
              serp_overlap_pct, shared_queries_count, pair_relation,
              kw_jaccard, kw_overlap_count
         FROM cannibalization_pairs
        WHERE severity IN ('high','medium')`,
    )
    .all() as Array<{
    pair_id: number;
    article_a_id: number;
    article_b_id: number;
    cosine_similarity: number;
    serp_overlap_pct: number | null;
    shared_queries_count: number | null;
    pair_relation: PairRelation | null;
    kw_jaccard: number | null;
    kw_overlap_count: number | null;
  }>;

  // ----- Phase A: ペア独立判定 (in-memory に集める) -----
  const phaseA: Array<{
    pair: typeof pairs[number];
    metrics: PairMetrics;
    decision: Decision;
    norm: NormalizableDecision;
  }> = [];

  for (const p of pairs) {
    const m = buildPairMetrics(db, p);
    if (!m) continue;
    const d = decidePair(m);
    phaseA.push({
      pair: p,
      metrics: m,
      decision: d,
      norm: {
        pair_id: p.pair_id,
        article_a_id: p.article_a_id,
        article_b_id: p.article_b_id,
        winner_article_id: d.target_article_id ?? null,
        action: d.action,
        confidence: d.confidence,
        rationale: d.rationale,
      },
    });
  }

  // ----- Phase B: グラフ正規化 (multi-target / role conflict) -----
  // 横断的 absoluteScore を構築: 各記事の被リンク・clicks・winner回数の重み加算
  const articleAbs = new Map<number, number>();
  const absRows = db
    .prepare(
      `SELECT a.article_id,
              COALESCE(p.clicks, 0) AS clicks,
              COALESCE(a.internal_links_in, 0) AS in_links,
              COALESCE(a.consolidate_winner_count, 0) AS winners,
              COALESCE(a.business_relevance_score, 0) AS rel
         FROM master_articles a
    LEFT JOIN article_performance_snapshots p
           ON p.article_id = a.article_id AND p.window_days = ?`,
    )
    .all(PERF_WINDOW_DAYS) as Array<{ article_id: number; clicks: number; in_links: number; winners: number; rel: number }>;
  for (const r of absRows) {
    articleAbs.set(
      r.article_id,
      r.clicks * 5 + r.in_links * 10 + r.winners * 3 + r.rel * 100,
    );
  }
  const absoluteScore = (id: number): number => articleAbs.get(id) ?? 0;

  const normReport = normalizeGraph(phaseA.map((x) => x.norm), absoluteScore);
  console.log('\n=== Phase B: graph normalize ===');
  console.log(`  CONSOLIDATE: ${normReport.consolidateBefore} → ${normReport.consolidateAfter}`);
  console.log(`  multi_target_demoted:  ${normReport.multiTargetDemoted}`);
  console.log(`  role_conflict_demoted: ${normReport.roleConflictDemoted}`);
  console.log(`  → MANUAL_REVIEW total: ${normReport.manualReview}`);

  // ----- Phase A の結果を Phase B で更新済 (norm.action) で DB 保存 -----
  const pairHist = new Map<string, number>();
  let pairDecisions = 0;
  const updateWinner = db.prepare(
    `UPDATE cannibalization_pairs
        SET winner_article_id = ?, winner_score = ?, winner_rationale_json = ?
      WHERE pair_id = ?`,
  );

  for (const x of phaseA) {
    // norm の action を反映した最終 decision
    const finalDecision: Decision = {
      ...x.decision,
      action: x.norm.action,
      rationale: x.norm.rationale,
      // 降格時は target を消す
      target_article_id: x.norm.action === 'CONSOLIDATE' ? x.decision.target_article_id : undefined,
      target_url: x.norm.action === 'CONSOLIDATE' ? x.decision.target_url : undefined,
    };
    insertDecision(db, { pair_id: x.pair.pair_id, decision: finalDecision });
    pairHist.set(finalDecision.action, (pairHist.get(finalDecision.action) ?? 0) + 1);
    pairDecisions++;

    if (finalDecision.action === 'CONSOLIDATE' && finalDecision.target_article_id) {
      const w = selectWinner(x.metrics.a, x.metrics.b);
      const targetIsWinner = w.winner.article_id === finalDecision.target_article_id;
      const winnerScore = targetIsWinner ? Math.max(w.score_a, w.score_b) : Math.min(w.score_a, w.score_b);
      updateWinner.run(
        finalDecision.target_article_id,
        winnerScore,
        JSON.stringify({ score_a: w.score_a, score_b: w.score_b, factors: finalDecision.rationale.factors }),
        x.pair.pair_id,
      );
    } else {
      // 降格された場合、winner_article_id をクリアして DB の整合性も保つ
      db.prepare('UPDATE cannibalization_pairs SET winner_article_id = NULL WHERE pair_id = ?').run(x.pair.pair_id);
    }
  }
  console.log('\n=== pair-level decisions (Phase B 適用後) ===');
  for (const [k, v] of [...pairHist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }

  // confidence histogram
  const conf = db
    .prepare(
      `SELECT
         CASE
           WHEN confidence_score >= 0.85 THEN '0.85+ (auto-OK)'
           WHEN confidence_score >= 0.6  THEN '0.6-0.85 (review)'
           ELSE '<0.6 (manual)'
         END AS bucket,
         COUNT(*) AS c
       FROM decision_log
       WHERE human_reviewed = 0
       GROUP BY bucket`,
    )
    .all() as Array<{ bucket: string; c: number }>;
  console.log('\n=== confidence distribution ===');
  for (const d of conf) console.log(`  ${d.bucket.padEnd(20)} ${d.c}`);

  recordAudit(db, {
    entityType: 'decision_log',
    entityId: 'bulk',
    action: 'create',
    after: {
      articles: articleDecisions,
      pairs: pairDecisions,
      article_dist: Object.fromEntries(articleHist),
      pair_dist: Object.fromEntries(pairHist),
      perf_window: PERF_WINDOW_DAYS,
    },
    actor: 'cli:run-engine',
    reason: 'Phase 3 Step 4 — bulk decision',
  });

  logger.info({ articleDecisions, pairDecisions }, 'run-engine done');
  closeDb();
}

main();
