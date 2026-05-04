/**
 * 各 subtopic / V軸 ノードに対し、
 * そこに属する記事 embedding の平均 (centroid) を計算して保存する。
 *
 * 入力: master_articles (subtopic_topic_id / vocabulary_topic_id が割当済み + article_embedding あり)
 * 出力: master_topics.centroid_vector / centroid_updated_at
 *
 * outlier 除外: 集合内 mean とのcos < 0.5 の記事は除く (Phase 2 既定)
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { blobToVector, cosine, vectorToBlob, VOYAGE_DIM } from '../lib/voyage.js';

const OUTLIER_THRESHOLD = 0.5;

type ArticleVec = { article_id: number; vec: Float32Array };

function meanVec(vecs: Float32Array[]): Float32Array {
  if (vecs.length === 0) return new Float32Array(VOYAGE_DIM);
  const out = new Float32Array(VOYAGE_DIM);
  for (const v of vecs) {
    for (let i = 0; i < VOYAGE_DIM; i++) out[i]! += v[i] ?? 0;
  }
  for (let i = 0; i < VOYAGE_DIM; i++) out[i]! /= vecs.length;
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < VOYAGE_DIM; i++) norm += out[i]! * out[i]!;
  norm = Math.sqrt(norm) + 1e-12;
  for (let i = 0; i < VOYAGE_DIM; i++) out[i]! /= norm;
  return out;
}

function computeCentroid(vecs: Float32Array[]): { centroid: Float32Array; kept: number; dropped: number } {
  if (vecs.length === 0) return { centroid: new Float32Array(VOYAGE_DIM), kept: 0, dropped: 0 };
  if (vecs.length === 1) return { centroid: vecs[0]!, kept: 1, dropped: 0 };
  // 1パス目: 全体 mean
  const initial = meanVec(vecs);
  // outlier 除外
  const kept = vecs.filter((v) => cosine(v, initial) >= OUTLIER_THRESHOLD);
  const dropped = vecs.length - kept.length;
  // 2パス目: 残ったベクトルだけで再計算
  const centroid = kept.length > 0 ? meanVec(kept) : initial;
  return { centroid, kept: kept.length, dropped };
}

function main() {
  const db = getDb();

  // subtopic centroid (subtopic_topic_id ベース)
  const subtopicGroups = db
    .prepare(
      `SELECT subtopic_topic_id AS topic_id, article_id, article_embedding
         FROM master_articles
        WHERE subtopic_topic_id IS NOT NULL
          AND article_embedding IS NOT NULL
          AND category_quarantine != 'confirmed'`,
    )
    .all() as Array<{ topic_id: string; article_id: number; article_embedding: Buffer }>;

  // vocabulary centroid (vocabulary_topic_id ベース)
  const vocabGroups = db
    .prepare(
      `SELECT vocabulary_topic_id AS topic_id, article_id, article_embedding
         FROM master_articles
        WHERE vocabulary_topic_id IS NOT NULL
          AND article_embedding IS NOT NULL
          AND category_quarantine != 'confirmed'`,
    )
    .all() as Array<{ topic_id: string; article_id: number; article_embedding: Buffer }>;

  function groupBy(rows: typeof subtopicGroups): Map<string, ArticleVec[]> {
    const m = new Map<string, ArticleVec[]>();
    for (const r of rows) {
      const arr = m.get(r.topic_id) ?? [];
      arr.push({ article_id: r.article_id, vec: blobToVector(r.article_embedding) });
      m.set(r.topic_id, arr);
    }
    return m;
  }

  const update = db.prepare(
    `UPDATE master_topics
        SET centroid_vector     = ?,
            centroid_updated_at = strftime('%s','now')
      WHERE topic_id = ?`,
  );

  const summary: Array<{ topic_id: string; n: number; kept: number; dropped: number }> = [];

  const tx = db.transaction((groups: Map<string, ArticleVec[]>) => {
    for (const [topicId, items] of groups) {
      const r = computeCentroid(items.map((it) => it.vec));
      update.run(vectorToBlob(Array.from(r.centroid)), topicId);
      summary.push({ topic_id: topicId, n: items.length, kept: r.kept, dropped: r.dropped });
    }
  });
  tx(groupBy(subtopicGroups));
  tx(groupBy(vocabGroups));

  summary.sort((a, b) => b.n - a.n);
  console.log('=== topic centroids ===');
  console.log('topic   n   kept dropped');
  for (const s of summary) {
    console.log(
      `${s.topic_id.padEnd(7)} ${String(s.n).padStart(3)} ${String(s.kept).padStart(4)} ${String(s.dropped).padStart(7)}`,
    );
  }

  recordAudit(db, {
    entityType: 'master_topics',
    entityId: 'bulk',
    action: 'update',
    after: { centroids_built: summary.length },
    actor: 'cli:topic-centroids',
    reason: 'Phase 2 Step 5',
  });

  logger.info({ topics: summary.length }, 'centroids built');
  closeDb();
}

main();
