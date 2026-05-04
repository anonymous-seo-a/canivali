import express from 'express';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { articlesRouter } from './routes/articles.js';
import { healthRouter } from './routes/health.js';
import { topicsRouter } from './routes/topics.js';

const app = express();
app.use(express.json());

app.use('/health', healthRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/topics', topicsRouter);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'server listening');
});
