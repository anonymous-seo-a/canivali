/**
 * category_quarantine='pending' な要判定 5件 (17549, 14056, 14077, 22431, 22539) を
 * 北極星との cosine 類似度で in_scope / confirmed に振り分ける。
 *
 * 判定基準:
 *   business_relevance_score >= IN_SCOPE_THRESHOLD → in_scope
 *   business_relevance_score < OUT_OF_SCOPE_THRESHOLD → confirmed
 *   間 → そのまま pending (人間判断に任せる)
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';

// 実測分布:
//   in_scope min = 0.561, in_scope cluster = 0.6–0.7, 99% は 0.6+
//   confirmed quarantine 5件は embedding しないので比較できないが、
//   北極星 (cardloan特化) と低類似 (≤0.5) なら確実に範囲外と判定可能。
const IN_SCOPE_THRESHOLD = 0.6;
const OUT_OF_SCOPE_THRESHOLD = 0.5;

type Row = {
  article_id: number;
  title: string;
  business_relevance_score: number | null;
  category_quarantine: string;
  quarantine_reason: string | null;
};

function decide(score: number | null): { quarantine: 'in_scope' | 'confirmed' | 'pending'; rationale: string } {
  if (score === null) return { quarantine: 'pending', rationale: 'no embedding score' };
  if (score >= IN_SCOPE_THRESHOLD) return { quarantine: 'in_scope', rationale: `score ${score.toFixed(3)} ≥ ${IN_SCOPE_THRESHOLD}` };
  if (score < OUT_OF_SCOPE_THRESHOLD)
    return { quarantine: 'confirmed', rationale: `score ${score.toFixed(3)} < ${OUT_OF_SCOPE_THRESHOLD}` };
  return { quarantine: 'pending', rationale: `score ${score.toFixed(3)} in gray zone — needs human review` };
}

function main() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT article_id, title, business_relevance_score, category_quarantine, quarantine_reason
         FROM master_articles
        WHERE category_quarantine = 'pending'`,
    )
    .all() as Row[];

  if (rows.length === 0) {
    logger.info('no pending articles to reclassify');
    closeDb();
    return;
  }

  console.log('=== pending articles ===');
  const update = db.prepare(
    `UPDATE master_articles
        SET category_quarantine = ?,
            quarantine_reason   = ?
      WHERE article_id = ?`,
  );

  let toInScope = 0;
  let toConfirmed = 0;
  let stillPending = 0;

  const tx = db.transaction((items: Row[]) => {
    for (const r of items) {
      const d = decide(r.business_relevance_score);
      const newReason = `[reclassify-pending ${new Date().toISOString().slice(0, 10)}] ${d.rationale}${r.quarantine_reason ? ` | prev: ${r.quarantine_reason}` : ''}`;
      console.log(
        `  [${r.article_id}] score=${r.business_relevance_score?.toFixed(3) ?? '—'}  ${d.quarantine.padEnd(9)}  ${r.title.slice(0, 50)}`,
      );
      if (d.quarantine !== 'pending') {
        update.run(d.quarantine, newReason, r.article_id);
        if (d.quarantine === 'in_scope') toInScope++;
        else toConfirmed++;
      } else {
        stillPending++;
      }
    }
  });
  tx(rows);

  recordAudit(db, {
    entityType: 'master_articles',
    entityId: 'pending_batch',
    action: 'update',
    after: { in_scope: toInScope, confirmed: toConfirmed, still_pending: stillPending, thresholds: { IN_SCOPE_THRESHOLD, OUT_OF_SCOPE_THRESHOLD } },
    actor: 'cli:reclassify-pending',
    reason: 'Phase 2 Step 4 — embedding-based pending resolution',
  });

  console.log(`\nresult: in_scope=${toInScope}  confirmed=${toConfirmed}  still_pending=${stillPending}`);
  closeDb();
}

main();
