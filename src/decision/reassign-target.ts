/**
 * REASSIGN 候補記事の「移動先 cell」を embedding と centroid 距離で決める。
 *
 * 入力: master_articles で classification_method='title_based' かつ
 *       (subtopic_topic_id IS NULL OR vocabulary_topic_id IS NULL OR classification_confidence < 0.7)
 * 処理:
 *   1. 各 subtopic_minor / vocabulary topic の centroid_vector を読み込む
 *   2. 記事 article_embedding と各 centroid の cosine を計算
 *   3. 上位 1 を「推奨 cell」として decision_log に REASSIGN_TARGET として記録
 * 出力:
 *   master_articles.subtopic_topic_id_suggested (新規 column) に提案を入れる
 *   decision_log で action='REASSIGN' のレコードに target_subtopic_id / target_vocabulary_id を埋める
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { blobToVector, cosine } from '../lib/voyage.js';

type Topic = { topic_id: string; topic_kind: string; centroid: Float32Array };
type Article = {
  article_id: number;
  vec: Float32Array;
  current_subtopic: string | null;
  current_vocab: string | null;
  classification_confidence: number | null;
};

function loadCentroids(db: ReturnType<typeof getDb>): { subtopics: Topic[]; vocabs: Topic[] } {
  const rows = db
    .prepare(
      `SELECT topic_id, topic_kind, centroid_vector
         FROM master_topics
        WHERE centroid_vector IS NOT NULL
          AND topic_kind IN ('subtopic_minor', 'vocabulary')`,
    )
    .all() as Array<{ topic_id: string; topic_kind: string; centroid_vector: Buffer }>;
  const subtopics: Topic[] = [];
  const vocabs: Topic[] = [];
  for (const r of rows) {
    const t: Topic = { topic_id: r.topic_id, topic_kind: r.topic_kind, centroid: blobToVector(r.centroid_vector) };
    if (r.topic_kind === 'subtopic_minor') subtopics.push(t);
    else vocabs.push(t);
  }
  return { subtopics, vocabs };
}

function nearestTopic(vec: Float32Array, topics: Topic[]): { topic_id: string; score: number } | null {
  let best: { topic_id: string; score: number } | null = null;
  for (const t of topics) {
    const c = cosine(vec, t.centroid);
    if (!best || c > best.score) best = { topic_id: t.topic_id, score: c };
  }
  return best;
}

function loadCandidateArticles(db: ReturnType<typeof getDb>): Article[] {
  return (
    db
      .prepare(
        `SELECT article_id, article_embedding,
                subtopic_topic_id AS current_subtopic,
                vocabulary_topic_id AS current_vocab,
                classification_confidence
           FROM master_articles
          WHERE article_embedding IS NOT NULL
            AND category_quarantine != 'confirmed'`,
      )
      .all() as Array<{
      article_id: number;
      article_embedding: Buffer;
      current_subtopic: string | null;
      current_vocab: string | null;
      classification_confidence: number | null;
    }>
  ).map((r) => ({
    article_id: r.article_id,
    vec: blobToVector(r.article_embedding),
    current_subtopic: r.current_subtopic,
    current_vocab: r.current_vocab,
    classification_confidence: r.classification_confidence,
  }));
}

function main() {
  const db = getDb();
  const { subtopics, vocabs } = loadCentroids(db);
  logger.info({ subtopics: subtopics.length, vocabs: vocabs.length }, 'centroids loaded');

  const articles = loadCandidateArticles(db);
  logger.info({ articles: articles.length }, 'articles to evaluate');

  const updateArticle = db.prepare(
    `UPDATE master_articles SET
       subtopic_topic_id   = CASE WHEN @apply=1 THEN @sub ELSE subtopic_topic_id END,
       vocabulary_topic_id = CASE WHEN @apply=1 THEN @v   ELSE vocabulary_topic_id END,
       classification_method = CASE WHEN @apply=1 THEN 'embedding_based' ELSE classification_method END,
       classification_confidence = CASE WHEN @apply=1 THEN @conf ELSE classification_confidence END,
       updated_at = strftime('%s','now')
     WHERE article_id = @article_id`,
  );

  // REASSIGN target を decision_log に保存 (engine.ts の出力と整合)
  const updateDl = db.prepare(
    `UPDATE decision_log SET
       target_subtopic_id   = ?,
       target_vocabulary_id = ?,
       confidence_score     = ?,
       rationale_json       = ?
     WHERE article_id = ? AND action='REASSIGN' AND human_reviewed=0`,
  );

  let suggestedChange = 0;
  let stable = 0;
  let highConfApply = 0;

  const tx = db.transaction((items: Article[]) => {
    for (const a of items) {
      const ns = nearestTopic(a.vec, subtopics);
      const nv = nearestTopic(a.vec, vocabs);
      if (!ns || !nv) continue;

      const subChange = ns.topic_id !== a.current_subtopic;
      const vChange = nv.topic_id !== a.current_vocab;
      const change = subChange || vChange;
      const confidence = (ns.score + nv.score) / 2;

      if (change) suggestedChange++;
      else stable++;

      // decision_log の REASSIGN レコードに target を埋める
      updateDl.run(
        ns.topic_id,
        nv.topic_id,
        confidence,
        JSON.stringify({
          factors: ['embedding_centroid_match'],
          scores: {
            subtopic_score: round(ns.score),
            vocab_score: round(nv.score),
            sub_change: subChange,
            v_change: vChange,
            from_subtopic: a.current_subtopic,
            from_vocab: a.current_vocab,
            to_subtopic: ns.topic_id,
            to_vocab: nv.topic_id,
          },
        }),
        a.article_id,
      );

      // confidence > 0.6 + 元の title_based confidence < 0.5 なら自動適用 (中信頼)
      const apply =
        change && confidence >= 0.65 && (a.classification_confidence ?? 1) < 0.5 ? 1 : 0;
      if (apply) highConfApply++;
      updateArticle.run({
        article_id: a.article_id,
        sub: ns.topic_id,
        v: nv.topic_id,
        conf: confidence,
        apply,
      });
    }
  });
  tx(articles);

  console.log('=== reassign-target results ===');
  console.log(`  evaluated:                 ${articles.length}`);
  console.log(`  suggested change:          ${suggestedChange}`);
  console.log(`  stable (no change):        ${stable}`);
  console.log(`  auto-applied (high conf):  ${highConfApply}`);

  recordAudit(db, {
    entityType: 'decision_log',
    entityId: 'reassign_target',
    action: 'update',
    after: { evaluated: articles.length, suggestedChange, autoApplied: highConfApply },
    actor: 'cli:reassign-target',
    reason: 'Phase 3 Step C',
  });

  closeDb();
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

main();
