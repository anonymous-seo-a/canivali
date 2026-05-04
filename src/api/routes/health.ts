import { Router } from 'express';
import { getDb } from '../../lib/db.js';

export const healthRouter: Router = Router();

healthRouter.get('/', (_req, res) => {
  try {
    const db = getDb();
    const r = db.prepare('SELECT COUNT(*) AS c FROM master_articles').get() as { c: number };
    res.json({ status: 'ok', articles: r.c });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
});
