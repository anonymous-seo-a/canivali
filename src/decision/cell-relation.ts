/**
 * cannibalization_pairs.pair_relation を埋める。
 * 各ペアの両記事の (subtopic_topic_id, vocabulary_topic_id) を見て、
 * 'same_cell' / 'same_subtopic_diff_v' / 'diff_subtopic_same_v' / 'fully_different' / 'unclassified'
 * のいずれかを割り当てる。
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export type PairRelation =
  | 'same_cell'
  | 'same_subtopic_diff_v'
  | 'diff_subtopic_same_v'
  | 'fully_different'
  | 'unclassified';

export function classifyPairRelation(
  aSubtopic: string | null,
  aVocab: string | null,
  bSubtopic: string | null,
  bVocab: string | null,
): PairRelation {
  if (!aSubtopic || !bSubtopic || !aVocab || !bVocab) return 'unclassified';
  const sameSub = aSubtopic === bSubtopic;
  const sameV = aVocab === bVocab;
  if (sameSub && sameV) return 'same_cell';
  if (sameSub && !sameV) return 'same_subtopic_diff_v';
  if (!sameSub && sameV) return 'diff_subtopic_same_v';
  return 'fully_different';
}

function main() {
  const db = getDb();
  const pairs = db
    .prepare(
      `SELECT cp.pair_id, cp.article_a_id, cp.article_b_id,
              a.subtopic_topic_id AS a_sub, a.vocabulary_topic_id AS a_v,
              b.subtopic_topic_id AS b_sub, b.vocabulary_topic_id AS b_v
         FROM cannibalization_pairs cp
         JOIN master_articles a ON a.article_id = cp.article_a_id
         JOIN master_articles b ON b.article_id = cp.article_b_id`,
    )
    .all() as Array<{
    pair_id: number;
    article_a_id: number;
    article_b_id: number;
    a_sub: string | null;
    a_v: string | null;
    b_sub: string | null;
    b_v: string | null;
  }>;

  const update = db.prepare('UPDATE cannibalization_pairs SET pair_relation = ? WHERE pair_id = ?');
  const histogram = new Map<PairRelation, number>();

  const tx = db.transaction(() => {
    for (const p of pairs) {
      const rel = classifyPairRelation(p.a_sub, p.a_v, p.b_sub, p.b_v);
      update.run(rel, p.pair_id);
      histogram.set(rel, (histogram.get(rel) ?? 0) + 1);
    }
  });
  tx();

  console.log('=== pair_relation distribution ===');
  for (const [k, v] of [...histogram.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(24)} ${v}`);
  }

  recordAudit(db, {
    entityType: 'cannibalization_pairs',
    entityId: 'bulk',
    action: 'update',
    after: Object.fromEntries(histogram),
    actor: 'cli:cell-relation',
    reason: 'Phase 3 Step 1',
  });

  logger.info({ pairs: pairs.length }, 'cell-relation done');
  closeDb();
}

main();
