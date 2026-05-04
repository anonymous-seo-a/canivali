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

decisionsRouter.get('/_/preview', (req, res) => {
  // 「実行プレビュー」用: 承認済 (or 全候補 / 自動承認候補) の CONSOLIDATE をペア単位で詳細列挙する。
  // mode = 'approved' (default) | 'auto' (conf >= 0.85) | 'all' (any unrejected)
  const db = getDb();
  const mode = (req.query.mode as string) || 'approved';

  let filter: string;
  if (mode === 'auto') {
    filter = "dl.action='CONSOLIDATE' AND dl.confidence_score >= 0.85 AND (dl.human_reviewed = 0 OR (dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')))";
  } else if (mode === 'all') {
    filter = "dl.action='CONSOLIDATE' AND (dl.human_reviewed = 0 OR (dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')))";
  } else {
    filter = "dl.action='CONSOLIDATE' AND dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')";
  }

  const rows = db
    .prepare(
      `SELECT dl.decision_id, dl.confidence_score, dl.rationale_json,
              dl.human_reviewed, dl.human_decision,
              cp.pair_id, cp.cosine_similarity, cp.serp_overlap_pct, cp.pair_relation, cp.severity,
              cp.winner_article_id,
              wa.article_id AS winner_id, wa.url AS winner_url, wa.title AS winner_title,
              wa.subtopic_topic_id AS winner_sub, wa.vocabulary_topic_id AS winner_v,
              pw.clicks AS winner_clicks, pw.impressions AS winner_impressions, pw.avg_position AS winner_pos,
              la.article_id AS loser_id, la.url AS loser_url, la.title AS loser_title,
              la.subtopic_topic_id AS loser_sub, la.vocabulary_topic_id AS loser_v,
              pl.clicks AS loser_clicks, pl.impressions AS loser_impressions, pl.avg_position AS loser_pos
         FROM decision_log dl
         JOIN cannibalization_pairs cp ON cp.pair_id = dl.pair_id
         JOIN master_articles wa ON wa.article_id = cp.winner_article_id
         JOIN master_articles la
           ON la.article_id = CASE WHEN cp.winner_article_id = cp.article_a_id THEN cp.article_b_id ELSE cp.article_a_id END
    LEFT JOIN article_performance_snapshots pw ON pw.article_id = wa.article_id AND pw.window_days = 90
    LEFT JOIN article_performance_snapshots pl ON pl.article_id = la.article_id AND pl.window_days = 90
        WHERE ${filter}
        ORDER BY dl.confidence_score DESC, cp.cosine_similarity DESC`,
    )
    .all() as Array<{
    decision_id: number;
    confidence_score: number;
    rationale_json: string;
    human_reviewed: number;
    human_decision: string | null;
    pair_id: number;
    cosine_similarity: number;
    serp_overlap_pct: number | null;
    pair_relation: string | null;
    severity: string;
    winner_article_id: number;
    winner_id: number;
    winner_url: string;
    winner_title: string;
    winner_sub: string | null;
    winner_v: string | null;
    winner_clicks: number | null;
    winner_impressions: number | null;
    winner_pos: number | null;
    loser_id: number;
    loser_url: string;
    loser_title: string;
    loser_sub: string | null;
    loser_v: string | null;
    loser_clicks: number | null;
    loser_impressions: number | null;
    loser_pos: number | null;
  }>;

  // loser ベースで dedup (1 つの記事が複数の winner にまとめられる候補になるケース → 最高 confidence のものだけ残す)
  const byLoser = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = byLoser.get(r.loser_id);
    if (!cur || r.confidence_score > cur.confidence_score) byLoser.set(r.loser_id, r);
  }

  const dedup = [...byLoser.values()];
  const totalArticles = (db.prepare('SELECT COUNT(*) AS c FROM master_articles').get() as { c: number }).c;
  const finalCount = totalArticles - dedup.length;

  res.json({
    mode,
    plan_count: dedup.length,
    raw_count: rows.length,
    final_article_count: finalCount,
    items: dedup,
  });
});

decisionsRouter.post('/_/execute', (req, res) => {
  // 統合実行。現状は dry-run (DB に execution_plan を記録 / 実行ログを残す) のみ。
  // WP REST API クライアントが揃ったら本処理に差し替える。
  const db = getDb();
  const { mode = 'approved', dry_run = true } = req.body as { mode?: string; dry_run?: boolean };

  // preview と同じ条件
  const previewReq = { query: { mode } } as unknown as Parameters<typeof decisionsRouter.get>[1];
  // 簡易呼び出し
  const filterClause =
    mode === 'auto'
      ? "dl.action='CONSOLIDATE' AND dl.confidence_score >= 0.85 AND (dl.human_reviewed = 0 OR (dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')))"
      : mode === 'all'
        ? "dl.action='CONSOLIDATE' AND (dl.human_reviewed = 0 OR (dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')))"
        : "dl.action='CONSOLIDATE' AND dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')";

  const items = db
    .prepare(
      `SELECT dl.decision_id, cp.pair_id, cp.winner_article_id,
              CASE WHEN cp.winner_article_id = cp.article_a_id THEN cp.article_b_id ELSE cp.article_a_id END AS loser_id,
              wa.url AS winner_url, la.url AS loser_url
         FROM decision_log dl
         JOIN cannibalization_pairs cp ON cp.pair_id = dl.pair_id
         JOIN master_articles wa ON wa.article_id = cp.winner_article_id
         JOIN master_articles la
           ON la.article_id = CASE WHEN cp.winner_article_id = cp.article_a_id THEN cp.article_b_id ELSE cp.article_a_id END
        WHERE ${filterClause}`,
    )
    .all() as Array<{ decision_id: number; pair_id: number; winner_article_id: number; loser_id: number; winner_url: string; loser_url: string }>;

  const byLoser = new Map<number, (typeof items)[number]>();
  for (const r of items) byLoser.set(r.loser_id, r);
  const plan = [...byLoser.values()];

  // 実行ログ
  recordAudit(db, {
    entityType: 'decision_log',
    entityId: 'execute',
    action: 'execute',
    after: { mode, dry_run, plan_size: plan.length, plan: plan.slice(0, 50) },
    actor: 'human:ui',
    reason: dry_run ? 'dry-run preview' : 'execute consolidation',
  });

  if (dry_run) {
    res.json({
      ok: true,
      dry_run: true,
      message: `${plan.length} 件の統合計画を生成しました (実行はされていません)`,
      plan,
    });
    return;
  }

  // 本実行: WP REST API 統合 (未実装)
  res.status(501).json({
    ok: false,
    error: 'WordPress REST API integration not yet configured. Set WP_API_BASE and WP_APP_PASSWORD in .env first.',
    plan_size: plan.length,
  });
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
