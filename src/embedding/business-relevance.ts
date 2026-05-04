/**
 * 北極星 (business_relevance.md §1 確定ステートメント) を embedding 化し、
 * 各 in_scope/pending 記事との cosine 類似度を business_relevance_score として保存する。
 *
 * 使い方:
 *   npx tsx src/embedding/business-relevance.ts
 *
 * 北極星本文が変更された場合、新しい version を生成して再 embedding する。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { blobToVector, cosine, embed, vectorToBlob, VOYAGE_MODEL } from '../lib/voyage.js';

const BR_VERSION = '2026-05-02-v1';
const BR_PATH = 'docs/strategic/business_relevance.md';

/**
 * business_relevance.md §1 セクションだけを抜き出す。
 * (## 1. 確定ステートメント の `> ...` ブロック)
 */
function extractStatement(): string {
  const md = readFileSync(resolve(BR_PATH), 'utf8');
  const m = md.match(/## 1\. 確定ステートメント[\s\S]*?\n>\s*(.+?)\n[\s\S]*?(?=\n##|\n---|$)/);
  if (!m || !m[1]) {
    throw new Error('business_relevance.md §1 が抽出できなかった');
  }
  return m[1].trim();
}

async function ensureNorthStarEmbedding(): Promise<{ id: number; vec: Float32Array }> {
  const db = getDb();
  const text = extractStatement();
  const hash = createHash('sha256').update(text).digest('hex');

  const existing = db
    .prepare('SELECT id, embedding FROM business_relevance_embeddings WHERE version=? AND content_hash=?')
    .get(BR_VERSION, hash) as { id: number; embedding: Buffer } | undefined;

  if (existing) {
    logger.info({ id: existing.id, version: BR_VERSION }, 'using cached north-star embedding');
    return { id: existing.id, vec: blobToVector(existing.embedding) };
  }

  logger.info({ version: BR_VERSION, len: text.length }, 'embedding north star');
  const r = await embed([text], 'document');
  const vec = r.embeddings[0]!;
  const ins = db
    .prepare(
      `INSERT INTO business_relevance_embeddings (version, content_hash, content_text, embedding, embedding_model)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(BR_VERSION, hash, text, vectorToBlob(vec), VOYAGE_MODEL);
  return { id: Number(ins.lastInsertRowid), vec: new Float32Array(vec) };
}

async function main() {
  const db = getDb();
  const ns = await ensureNorthStarEmbedding();

  const rows = db
    .prepare(
      `SELECT article_id, article_embedding
         FROM master_articles
        WHERE article_embedding IS NOT NULL
          AND category_quarantine != 'confirmed'`,
    )
    .all() as Array<{ article_id: number; article_embedding: Buffer }>;

  logger.info({ count: rows.length }, 'computing business_relevance_score');

  const update = db.prepare(
    `UPDATE master_articles SET business_relevance_score = ?, business_relevance_version = ? WHERE article_id = ?`,
  );

  const tx = db.transaction((items: typeof rows) => {
    for (const r of items) {
      const v = blobToVector(r.article_embedding);
      const score = cosine(v, ns.vec);
      update.run(score, BR_VERSION, r.article_id);
    }
  });
  tx(rows);

  // 簡易ヒストグラム
  const buckets = new Map<string, number>();
  const dist = db
    .prepare(
      `SELECT
         CASE
           WHEN business_relevance_score >= 0.9 THEN '0.9+'
           WHEN business_relevance_score >= 0.8 THEN '0.8-0.9'
           WHEN business_relevance_score >= 0.7 THEN '0.7-0.8'
           WHEN business_relevance_score >= 0.6 THEN '0.6-0.7'
           WHEN business_relevance_score >= 0.5 THEN '0.5-0.6'
           ELSE '<0.5'
         END AS bucket,
         COUNT(*) AS c
       FROM master_articles
       WHERE business_relevance_score IS NOT NULL
       GROUP BY bucket
       ORDER BY bucket DESC`,
    )
    .all() as Array<{ bucket: string; c: number }>;
  for (const d of dist) buckets.set(d.bucket, d.c);

  recordAudit(db, {
    entityType: 'master_articles',
    entityId: 'bulk',
    action: 'update',
    after: { scored: rows.length, version: BR_VERSION, distribution: Object.fromEntries(buckets) },
    actor: 'cli:business-relevance',
    reason: 'Phase 2 Step 2-3 — north-star score',
  });

  console.log('\n=== business_relevance_score distribution ===');
  for (const d of dist) console.log(`  ${d.bucket.padEnd(10)} ${d.c}`);
  closeDb();
}

main().catch((e) => {
  logger.error(e, 'fatal');
  process.exit(1);
});
