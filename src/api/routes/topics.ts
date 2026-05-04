import { Router } from 'express';
import { getDb } from '../../lib/db.js';

export const topicsRouter: Router = Router();

topicsRouter.get('/', (req, res) => {
  const db = getDb();
  const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
  const sql = kind
    ? `SELECT topic_id, topic_kind, parent_topic_id, axis_letter, vocabulary_group, name, description
         FROM master_topics WHERE topic_kind = ? ORDER BY topic_id`
    : `SELECT topic_id, topic_kind, parent_topic_id, axis_letter, vocabulary_group, name, description
         FROM master_topics ORDER BY topic_id`;
  const rows = kind ? db.prepare(sql).all(kind) : db.prepare(sql).all();
  res.json(rows);
});

topicsRouter.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM master_topics WHERE topic_id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(row);
});
