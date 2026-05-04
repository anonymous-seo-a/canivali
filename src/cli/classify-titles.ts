/**
 * 全 master_articles を走査し、タイトルから (subtopic, vocabulary) セルを推定して埋める。
 *
 * 確定汚染 (category_quarantine='confirmed') はセル割当しない。
 * pending は割当する (Phase 2 で本文 embedding により再判定される前提)。
 */
import { classifyTitle, deriveSubtopicAxis } from '../classification/title-to-cell.js';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';

type Row = { article_id: number; title: string; category_quarantine: string };

function main() {
  const db = getDb();
  const rows = db
    .prepare('SELECT article_id, title, category_quarantine FROM master_articles ORDER BY article_id')
    .all() as Row[];

  const update = db.prepare(`
    UPDATE master_articles SET
      subtopic_axis              = @subtopic_axis,
      subtopic_topic_id          = @subtopic_topic_id,
      vocabulary_topic_id        = @vocabulary_topic_id,
      classification_method      = 'title_based',
      classification_confidence  = @confidence,
      updated_at                 = strftime('%s','now')
    WHERE article_id = @article_id
  `);

  let assigned = 0;
  let bothMissing = 0;
  let onlyOne = 0;
  let skipped = 0;

  const tx = db.transaction((items: Row[]) => {
    for (const r of items) {
      if (r.category_quarantine === 'confirmed') {
        skipped++;
        continue;
      }
      const c = classifyTitle(r.title);
      const axis = deriveSubtopicAxis(c.subtopic_topic_id);
      update.run({
        article_id: r.article_id,
        subtopic_axis: axis,
        subtopic_topic_id: c.subtopic_topic_id,
        vocabulary_topic_id: c.vocabulary_topic_id,
        confidence: c.confidence,
      });
      if (c.subtopic_topic_id && c.vocabulary_topic_id) assigned++;
      else if (c.subtopic_topic_id || c.vocabulary_topic_id) onlyOne++;
      else bothMissing++;
    }
  });
  tx(rows);

  recordAudit(db, {
    entityType: 'master_articles',
    entityId: 'bulk',
    action: 'update',
    after: { assigned, onlyOne, bothMissing, skipped, total: rows.length },
    actor: 'cli:classify-titles',
    reason: 'title-based classification',
  });

  logger.info({ total: rows.length, assigned, onlyOne, bothMissing, skipped }, 'classify-titles done');
  closeDb();
}

main();
