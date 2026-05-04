import { Router } from 'express';
import { getDb, recordAudit } from '../../lib/db.js';

export const decisionsRouter: Router = Router();

decisionsRouter.get('/', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit ?? 100), 1000);
  const offset = Number(req.query.offset ?? 0);
  const action = typeof req.query.action === 'string' ? req.query.action : null;
  const reviewed = req.query.reviewed === '1' ? 1 : req.query.reviewed === '0' ? 0 : null;
  const minConf = Number(req.query.min_conf ?? 0);
  const kind = typeof req.query.kind === 'string' ? req.query.kind : null; // 'article' | 'pair'

  const where: string[] = ['confidence_score >= @minConf'];
  const params: Record<string, unknown> = { limit, offset, minConf };
  if (action) {
    where.push('action = @action');
    params.action = action;
  }
  if (reviewed !== null) {
    where.push('human_reviewed = @reviewed');
    params.reviewed = reviewed;
  }
  if (kind === 'article') where.push('article_id IS NOT NULL AND pair_id IS NULL');
  if (kind === 'pair') where.push('pair_id IS NOT NULL');
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM decision_log ${whereSql}`).all(params) as Array<{ c: number }>;
  const total = totalRow[0]?.c ?? 0;

  const rows = db
    .prepare(
      `SELECT dl.decision_id, dl.article_id, dl.pair_id, dl.action,
              dl.target_url, dl.target_subtopic_id, dl.target_vocabulary_id,
              dl.confidence_score, dl.rationale_json, dl.human_reviewed, dl.human_decision,
              dl.decided_at,
              -- 関連メタ
              a.title AS article_title, a.url AS article_url,
              cp.cosine_similarity, cp.serp_overlap_pct, cp.pair_relation, cp.severity,
              cp.winner_article_id,
              cp.article_a_id, cp.article_b_id,
              wa.title AS a_title, wa.url AS a_url,
              wb.title AS b_title, wb.url AS b_url
         FROM decision_log dl
    LEFT JOIN master_articles a   ON a.article_id = dl.article_id
    LEFT JOIN cannibalization_pairs cp ON cp.pair_id = dl.pair_id
    LEFT JOIN master_articles wa  ON wa.article_id = cp.article_a_id
    LEFT JOIN master_articles wb  ON wb.article_id = cp.article_b_id
    ${whereSql}
        ORDER BY dl.confidence_score DESC, dl.decided_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all(params);
  res.json({ total, items: rows });
});

decisionsRouter.get('/_/impact', (_req, res) => {
  const db = getDb();
  // 全ての CONSOLIDATE 判定 (未承認 + 承認済) を見て、
  // 「どの記事が消える (loser)」「どの記事が canonical として残る (winner)」を算出。
  const total = (db.prepare('SELECT COUNT(*) AS c FROM master_articles').get() as { c: number }).c;
  const confirmedQuarantine = (
    db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE category_quarantine='confirmed'").get() as {
      c: number;
    }
  ).c;

  // CONSOLIDATE 判定で承認済 (human_reviewed=1, human_decision != 'REJECTED')
  // のペアの loser を抽出 (= 削除/リダイレクト対象)
  const approvedLosers = db
    .prepare(
      `SELECT DISTINCT
              CASE WHEN cp.winner_article_id = cp.article_a_id THEN cp.article_b_id ELSE cp.article_a_id END AS loser_id
         FROM decision_log dl
         JOIN cannibalization_pairs cp ON cp.pair_id = dl.pair_id
        WHERE dl.action = 'CONSOLIDATE'
          AND dl.human_reviewed = 1
          AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')
          AND cp.winner_article_id IS NOT NULL`,
    )
    .all() as Array<{ loser_id: number }>;

  // 未承認の CONSOLIDATE candidate の loser
  const pendingLosers = db
    .prepare(
      `SELECT DISTINCT
              CASE WHEN cp.winner_article_id = cp.article_a_id THEN cp.article_b_id ELSE cp.article_a_id END AS loser_id
         FROM decision_log dl
         JOIN cannibalization_pairs cp ON cp.pair_id = dl.pair_id
        WHERE dl.action = 'CONSOLIDATE'
          AND dl.human_reviewed = 0
          AND cp.winner_article_id IS NOT NULL`,
    )
    .all() as Array<{ loser_id: number }>;

  // pending DELETE 判定の対象記事
  const pendingDeletes = db
    .prepare(
      `SELECT DISTINCT article_id
         FROM decision_log
        WHERE action = 'DELETE' AND article_id IS NOT NULL AND human_reviewed = 0`,
    )
    .all() as Array<{ article_id: number }>;

  // 承認済 DELETE
  const approvedDeletes = db
    .prepare(
      `SELECT DISTINCT article_id
         FROM decision_log
        WHERE action = 'DELETE' AND article_id IS NOT NULL AND human_reviewed = 1
          AND (human_decision IS NULL OR human_decision != 'REJECTED')`,
    )
    .all() as Array<{ article_id: number }>;

  res.json({
    total,
    confirmedQuarantine,
    approved: {
      losers: approvedLosers.map((l) => l.loser_id),
      deletes: approvedDeletes.map((d) => d.article_id),
    },
    pending: {
      losers: pendingLosers.map((l) => l.loser_id),
      deletes: pendingDeletes.map((d) => d.article_id),
    },
  });
});

decisionsRouter.get('/_/summary', (_req, res) => {
  const db = getDb();
  const byAction = db
    .prepare(
      `SELECT action, COUNT(*) AS c, AVG(confidence_score) AS avg_conf
         FROM decision_log
        WHERE human_reviewed = 0
        GROUP BY action ORDER BY c DESC`,
    )
    .all();
  const byConfBucket = db
    .prepare(
      `SELECT
         CASE
           WHEN confidence_score >= 0.85 THEN '0.85+'
           WHEN confidence_score >= 0.6  THEN '0.6-0.85'
           ELSE '<0.6'
         END AS bucket,
         COUNT(*) AS c
       FROM decision_log
       WHERE human_reviewed = 0
       GROUP BY bucket`,
    )
    .all();
  res.json({ byAction, byConfBucket });
});

decisionsRouter.post('/:id/review', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { action, decision, note } = req.body as { action?: string; decision?: string; note?: string };
  // action == 'approve' | 'modify' | 'reject'
  const before = db.prepare('SELECT * FROM decision_log WHERE decision_id = ?').get(id);
  if (!before) {
    res.status(404).json({ error: 'decision not found' });
    return;
  }
  if (action === 'approve') {
    db.prepare(
      `UPDATE decision_log SET human_reviewed = 1, human_decision = NULL, reviewed_at = strftime('%s','now') WHERE decision_id = ?`,
    ).run(id);
  } else if (action === 'modify') {
    db.prepare(
      `UPDATE decision_log SET human_reviewed = 1, human_decision = ?, reviewed_at = strftime('%s','now') WHERE decision_id = ?`,
    ).run(decision ?? null, id);
  } else if (action === 'reject') {
    db.prepare(
      `UPDATE decision_log SET human_reviewed = 1, human_decision = 'REJECTED', reviewed_at = strftime('%s','now') WHERE decision_id = ?`,
    ).run(id);
  } else {
    res.status(400).json({ error: 'unknown action' });
    return;
  }
  recordAudit(db, {
    entityType: 'decision_log',
    entityId: String(id),
    action: 'update',
    before,
    after: { action, decision, note },
    actor: 'human:ui',
    reason: 'human review',
  });
  const after = db.prepare('SELECT * FROM decision_log WHERE decision_id = ?').get(id);
  res.json(after);
});
