import { Router } from 'express';
import { getDb } from '../../lib/db.js';

export const statsRouter: Router = Router();

statsRouter.get('/overview', (_req, res) => {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM master_articles').get() as { c: number }).c;
  const inScope = (db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE category_quarantine='in_scope'").get() as { c: number }).c;
  const confirmed = (db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE category_quarantine='confirmed'").get() as { c: number }).c;
  const consolidated = (db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE status='consolidated'").get() as { c: number }).c;
  const embedded = (db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE article_embedding IS NOT NULL").get() as { c: number }).c;

  const pairs = db.prepare(
    `SELECT severity, COUNT(*) AS c FROM cannibalization_pairs GROUP BY severity ORDER BY severity`,
  ).all();
  const pairRelations = db.prepare(
    `SELECT pair_relation, COUNT(*) AS c FROM cannibalization_pairs GROUP BY pair_relation ORDER BY c DESC`,
  ).all();
  const decisions = db.prepare(
    `SELECT action, COUNT(*) AS c, ROUND(AVG(confidence_score),3) AS avg_conf
       FROM decision_log GROUP BY action ORDER BY c DESC`,
  ).all();

  res.json({
    articles: { total, inScope, confirmed, consolidated, embedded },
    pairs,
    pairRelations,
    decisions,
  });
});

statsRouter.get('/cosine-histogram', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         ROUND(cosine_similarity * 100) / 100.0 AS bucket,
         COUNT(*) AS c
       FROM cannibalization_pairs
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all();
  res.json(rows);
});

statsRouter.get('/relevance-histogram', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         CASE
           WHEN business_relevance_score >= 0.78 THEN '0.78+'
           WHEN business_relevance_score >= 0.74 THEN '0.74-0.78'
           WHEN business_relevance_score >= 0.70 THEN '0.70-0.74'
           WHEN business_relevance_score >= 0.66 THEN '0.66-0.70'
           WHEN business_relevance_score >= 0.62 THEN '0.62-0.66'
           WHEN business_relevance_score >= 0.58 THEN '0.58-0.62'
           ELSE '<0.58'
         END AS bucket,
         COUNT(*) AS c
       FROM master_articles
       WHERE business_relevance_score IS NOT NULL
       GROUP BY bucket
       ORDER BY bucket DESC`,
    )
    .all();
  res.json(rows);
});

statsRouter.get('/top-cells', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT subtopic_topic_id AS subtopic, vocabulary_topic_id AS vocab,
              COUNT(*) AS articles
         FROM master_articles
        WHERE category_quarantine != 'confirmed'
        GROUP BY subtopic, vocab
        HAVING COUNT(*) > 1
        ORDER BY articles DESC
        LIMIT 30`,
    )
    .all();
  res.json(rows);
});

statsRouter.get('/top-articles', (_req, res) => {
  const db = getDb();
  const window = Number((_req.query as { window?: string }).window ?? 90);
  const limit = Math.min(Number((_req.query as { limit?: string }).limit ?? 20), 100);
  const rows = db
    .prepare(
      `SELECT a.article_id, a.url, a.title, a.subtopic_topic_id, a.vocabulary_topic_id,
              a.business_relevance_score,
              p.clicks, p.impressions, p.ctr, p.avg_position
         FROM master_articles a
    LEFT JOIN article_performance_snapshots p
           ON p.article_id = a.article_id AND p.window_days = ?
        WHERE a.category_quarantine != 'confirmed'
        ORDER BY p.clicks DESC NULLS LAST
        LIMIT ?`,
    )
    .all(window, limit);
  res.json(rows);
});

statsRouter.get('/lift-report', (_req, res) => {
  const db = getDb();
  const items = db
    .prepare(
      `SELECT ce.execution_id, ce.pair_id, ce.executed_at, ce.observed_at,
              ce.baseline_combined_clicks, ce.baseline_combined_imps,
              ce.observed_winner_clicks, ce.observed_winner_imps, ce.observed_winner_pos,
              ce.lift_clicks_pct, ce.lift_imps_pct, ce.lift_status,
              wa.url AS winner_url, wa.title AS winner_title,
              la.url AS loser_url,  la.title AS loser_title
         FROM consolidation_executions ce
         JOIN master_articles wa ON wa.article_id = ce.winner_article_id
         JOIN master_articles la ON la.article_id = ce.loser_article_id
        ORDER BY ce.executed_at DESC
        LIMIT 200`,
    )
    .all();

  const summary = db
    .prepare(
      `SELECT lift_status, COUNT(*) AS c,
              ROUND(AVG(lift_clicks_pct),3) AS avg_clicks_lift,
              ROUND(AVG(lift_imps_pct),3) AS avg_imps_lift
         FROM consolidation_executions
        GROUP BY lift_status`,
    )
    .all();

  res.json({ items, summary });
});
