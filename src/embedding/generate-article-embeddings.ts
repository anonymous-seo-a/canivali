/**
 * 全 in_scope + pending 記事に対して body_text の embedding を生成し
 * master_articles.article_embedding に保存する。
 *
 * 使い方:
 *   npx tsx src/embedding/generate-article-embeddings.ts            # 未生成のみ
 *   npx tsx src/embedding/generate-article-embeddings.ts --force    # 全件再生成
 *   npx tsx src/embedding/generate-article-embeddings.ts --limit=10 # 先頭 N 件のみ
 */
import type Database from 'better-sqlite3';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { embed, vectorToBlob, VOYAGE_MODEL } from '../lib/voyage.js';

type Row = {
  article_id: number;
  title: string;
  body_text: string | null;
};

// Voyage の制約:
//   - 1 input あたり最大 32,000 tokens
//   - 1 batch あたり最大 120,000 tokens
// 日本語の rough estimate: 1 token ≈ 2 chars (実測 11k tokens / 21k chars 程度)
const TOKEN_BUDGET_PER_BATCH = 100_000; // 安全マージン
const MAX_BODY_CHARS = 20_000; // 約 10k tokens/input → 1 input が単独で上限超えしない
const TOKEN_PER_CHAR_ESTIMATE = 0.6; // 多めに見積もる (実測ベース)

function pickArticles(db: Database.Database, force: boolean, limit: number | null): Row[] {
  const baseSql = `
    SELECT article_id, title, body_text
      FROM master_articles
     WHERE category_quarantine != 'confirmed'
       AND body_text IS NOT NULL
       ${force ? '' : 'AND article_embedding IS NULL'}
     ORDER BY article_id
     ${limit ? `LIMIT ${limit}` : ''}
  `;
  return db.prepare(baseSql).all() as Row[];
}

function buildInput(row: Row): string {
  const body = (row.body_text ?? '').slice(0, MAX_BODY_CHARS);
  // タイトルを冒頭に付けて意味の中心を強調 (Voyage doc の推奨パターン)
  return `${row.title}\n\n${body}`;
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length * TOKEN_PER_CHAR_ESTIMATE);
}

function packBatches(rows: Row[]): Array<{ rows: Row[]; inputs: string[]; estTokens: number }> {
  const batches: Array<{ rows: Row[]; inputs: string[]; estTokens: number }> = [];
  let cur: { rows: Row[]; inputs: string[]; estTokens: number } = { rows: [], inputs: [], estTokens: 0 };
  for (const r of rows) {
    const input = buildInput(r);
    const t = estimateTokens(input);
    if (cur.rows.length > 0 && cur.estTokens + t > TOKEN_BUDGET_PER_BATCH) {
      batches.push(cur);
      cur = { rows: [], inputs: [], estTokens: 0 };
    }
    cur.rows.push(r);
    cur.inputs.push(input);
    cur.estTokens += t;
  }
  if (cur.rows.length > 0) batches.push(cur);
  return batches;
}

async function main() {
  const argv = new Set(process.argv.slice(2));
  const force = argv.has('--force');
  const limitArg = [...argv].find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

  const db = getDb();
  const rows = pickArticles(db, force, limit);
  logger.info({ count: rows.length, force, limit }, 'articles to embed');
  if (rows.length === 0) {
    closeDb();
    return;
  }

  const update = db.prepare(`
    UPDATE master_articles SET
      article_embedding    = @blob,
      embedding_model      = @model,
      embedding_updated_at = @ts
    WHERE article_id = @article_id
  `);

  let totalTokens = 0;
  let okCount = 0;
  let failCount = 0;
  const batches = packBatches(rows);
  logger.info(
    { batches: batches.length, avg_per_batch: Math.round(rows.length / batches.length) },
    'batches packed',
  );

  let processed = 0;
  for (const batch of batches) {
    try {
      const r = await embed(batch.inputs, 'document');
      totalTokens += r.tokens;
      const tx = db.transaction((items: Array<{ row: Row; vec: number[] }>) => {
        const ts = Math.floor(Date.now() / 1000);
        for (const it of items) {
          update.run({
            article_id: it.row.article_id,
            blob: vectorToBlob(it.vec),
            model: VOYAGE_MODEL,
            ts,
          });
        }
      });
      tx(batch.rows.map((row, j) => ({ row, vec: r.embeddings[j]! })));
      okCount += batch.rows.length;
      processed += batch.rows.length;
      logger.info(
        { progress: `${processed}/${rows.length}`, tokens: totalTokens, batch_size: batch.rows.length, batch_tokens: r.tokens },
        'batch complete',
      );
    } catch (e) {
      failCount += batch.rows.length;
      processed += batch.rows.length;
      logger.error(
        { err: e instanceof Error ? e.message : String(e), ids: batch.rows.map((r) => r.article_id), est_tokens: batch.estTokens },
        'batch failed',
      );
    }
  }

  recordAudit(db, {
    entityType: 'master_articles',
    entityId: 'bulk',
    action: 'update',
    after: { embedded: okCount, failed: failCount, tokens: totalTokens, model: VOYAGE_MODEL },
    actor: 'cli:generate-article-embeddings',
    reason: 'Phase 2 Step 1 — article body embeddings',
  });

  logger.info({ ok: okCount, fail: failCount, tokens: totalTokens }, 'done');
  closeDb();
}

main().catch((e) => {
  logger.error(e, 'fatal');
  process.exit(1);
});
