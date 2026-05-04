/**
 * 統合実行から 28日以上経過した execution に対して、
 * 直近 28日のパフォーマンスを取り、ベースライン (実行前 combined) との差分 = lift を計算する。
 *
 * 前提: gsc_query_url_snapshots に execution 後のデータが既に取り込まれている (npm run pull:gsc)。
 *
 * 使い方:
 *   npm run decide:lift             # 全 'pending' execution を再評価
 *   npm run decide:lift -- --force  # 'measured' も再計算
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';

const MIN_DAYS_AFTER_EXEC = 28;

function main() {
  const force = process.argv.includes('--force');
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - MIN_DAYS_AFTER_EXEC * 86_400;

  const rows = db
    .prepare(
      `SELECT execution_id, pair_id, winner_article_id, loser_article_id, executed_at,
              baseline_combined_clicks, baseline_combined_imps,
              lift_status
         FROM consolidation_executions
        WHERE executed_at <= ? AND (lift_status='pending' OR ?)`,
    )
    .all(cutoff, force ? 1 : 0) as Array<{
    execution_id: number;
    pair_id: number;
    winner_article_id: number;
    loser_article_id: number;
    executed_at: number;
    baseline_combined_clicks: number;
    baseline_combined_imps: number;
    lift_status: string;
  }>;

  logger.info({ candidates: rows.length, cutoff: new Date(cutoff * 1000).toISOString() }, 'lift compute begin');

  const update = db.prepare(
    `UPDATE consolidation_executions
        SET observed_at = strftime('%s','now'),
            observed_winner_clicks = ?,
            observed_winner_imps = ?,
            observed_winner_pos = ?,
            lift_clicks_pct = ?,
            lift_imps_pct = ?,
            lift_status = 'measured',
            updated_at = strftime('%s','now')
      WHERE execution_id = ?`,
  );

  let measured = 0;
  for (const r of rows) {
    // 最新スナップショット (window=90) を取る
    const snap = db
      .prepare(
        `SELECT clicks, impressions, avg_position
           FROM article_performance_snapshots
          WHERE article_id = ? AND window_days = 90
          ORDER BY snapshot_date DESC LIMIT 1`,
      )
      .get(r.winner_article_id) as { clicks: number; impressions: number; avg_position: number } | undefined;
    if (!snap) {
      logger.warn({ execution_id: r.execution_id }, 'no winner snapshot yet');
      continue;
    }
    const liftClicks = r.baseline_combined_clicks > 0
      ? (snap.clicks - r.baseline_combined_clicks) / r.baseline_combined_clicks
      : null;
    const liftImps = r.baseline_combined_imps > 0
      ? (snap.impressions - r.baseline_combined_imps) / r.baseline_combined_imps
      : null;

    update.run(snap.clicks, snap.impressions, snap.avg_position, liftClicks, liftImps, r.execution_id);
    measured++;
  }

  recordAudit(db, {
    entityType: 'consolidation_executions',
    entityId: 'bulk',
    action: 'update',
    after: { measured, candidates: rows.length },
    actor: 'cli:compute-lift',
    reason: 'Phase 4-C lift verification',
  });

  console.log(`=== compute-lift ===`);
  console.log(`candidates: ${rows.length}, measured: ${measured}`);
  closeDb();
}

main();
