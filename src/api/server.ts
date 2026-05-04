import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { articlesRouter } from './routes/articles.js';
import { decisionsRouter } from './routes/decisions.js';
import { healthRouter } from './routes/health.js';
import { topicsRouter } from './routes/topics.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/health', healthRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/topics', topicsRouter);
app.use('/api/decisions', decisionsRouter);

// 本番モード: Vite で build した dist/ui/ を Express から serve
const distUi = resolve('dist/ui');
if (env.NODE_ENV === 'production' && existsSync(distUi)) {
  app.use(express.static(distUi));
  app.get('*', (_req, res) => {
    res.sendFile(resolve(distUi, 'index.html'));
  });
  logger.info({ distUi }, 'serving built UI from dist/ui');
}

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server listening');
});
