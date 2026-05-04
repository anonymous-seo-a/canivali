import { Router } from 'express';
import { getDb } from '../../lib/db.js';

export const articlesRouter: Router = Router();

articlesRouter.get('/', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const offset = Number(req.query.offset ?? 0);
  const quarantine = typeof req.query.quarantine === 'string' ? req.query.quarantine : null;
  const subtopic = typeof req.query.subtopic === 'string' ? req.query.subtopic : null;
  const vocabulary = typeof req.query.vocabulary === 'string' ? req.query.vocabulary : null;

  const where: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (quarantine) {
    where.push('category_quarantine = @quarantine');
    params.quarantine = quarantine;
  }
  if (subtopic) {
    where.push('subtopic_topic_id = @subtopic');
    params.subtopic = subtopic;
  }
  if (vocabulary) {
    where.push('vocabulary_topic_id = @vocabulary');
    params.vocabulary = vocabulary;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM master_articles ${whereSql}`).all(params) as Array<{ c: number }>;
  const total = totalRow[0]?.c ?? 0;

  const rows = db
    .prepare(
      `SELECT article_id, url, title, status,
              subtopic_axis, subtopic_topic_id, vocabulary_topic_id,
              classification_method, classification_confidence,
              category_quarantine, quarantine_reason,
              word_count, publish_date, last_modified, crawled_at
         FROM master_articles ${whereSql}
         ORDER BY article_id ASC
         LIMIT @limit OFFSET @offset`,
    )
    .all(params);
  res.json({ total, items: rows });
});

articlesRouter.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM master_articles WHERE article_id = ?').get(Number(req.params.id));
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(row);
});

articlesRouter.get('/_/cells', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT subtopic_topic_id, vocabulary_topic_id, COUNT(*) AS c
         FROM master_articles
        WHERE category_quarantine != 'confirmed'
        GROUP BY subtopic_topic_id, vocabulary_topic_id
        ORDER BY c DESC`,
    )
    .all();
  res.json(rows);
});
