/**
 * 全 in_scope 記事ペアの cosine 類似度を計算し、
 * 閾値以上のペアを cannibalization_pairs に投入する。
 *
 * 入力: master_articles (article_embedding あり, category_quarantine != 'confirmed')
 * 出力: cannibalization_pairs (cosine_similarity, severity)
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { blobToVector, cosine } from '../lib/voyage.js';

const THRESHOLDS = {
  high: 0.9,
  medium: 0.85,
  low: 0.8,
};
const MIN_THRESHOLD = THRESHOLDS.low;

type Row = { article_id: number; article_embedding: Buffer };

function severityOf(c: number): 'high' | 'medium' | 'low' {
  if (c >= THRESHOLDS.high) return 'high';
  if (c >= THRESHOLDS.medium) return 'medium';
  return 'low';
}

function main() {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT article_id, article_embedding
         FROM master_articles
        WHERE article_embedding IS NOT NULL
          AND category_quarantine != 'confirmed'
        ORDER BY article_id`,
    )
    .all() as Row[];

  logger.info({ count: rows.length, pairs: (rows.length * (rows.length - 1)) / 2 }, 'computing pair cosines');

  const ids = rows.map((r) => r.article_id);
  const vecs = rows.map((r) => blobToVector(r.article_embedding));

  // 既存ペアをクリア (再実行可能性確保)
  db.exec('DELETE FROM cannibalization_pairs');

  const ins = db.prepare(`
    INSERT INTO cannibalization_pairs
      (article_a_id, article_b_id, cosine_similarity, severity, detected_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
  `);

  let inserted = 0;
  const histogram = new Map<string, number>();

  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const c = cosine(vecs[i]!, vecs[j]!);
        if (c < MIN_THRESHOLD) continue;
        const sev = severityOf(c);
        // article_a_id < article_b_id (CHECK 制約)
        const aid = Math.min(ids[i]!, ids[j]!);
        const bid = Math.max(ids[i]!, ids[j]!);
        ins.run(aid, bid, c, sev);
        inserted++;
        histogram.set(sev, (histogram.get(sev) ?? 0) + 1);
      }
    }
  });
  tx();

  console.log('=== cannibalization_pairs ===');
  console.log(`total: ${inserted}`);
  for (const [sev, count] of histogram) console.log(`  ${sev.padEnd(8)} ${count}`);

  // 上位ペアを覗く
  const top = db
    .prepare(
      `SELECT cp.article_a_id, a.title AS a_title, cp.article_b_id, b.title AS b_title, cp.cosine_similarity
         FROM cannibalization_pairs cp
         JOIN master_articles a ON a.article_id = cp.article_a_id
         JOIN master_articles b ON b.article_id = cp.article_b_id
        ORDER BY cp.cosine_similarity DESC
        LIMIT 10`,
    )
    .all() as Array<{ article_a_id: number; a_title: string; article_b_id: number; b_title: string; cosine_similarity: number }>;
  console.log('\n=== top 10 by cosine ===');
  for (const t of top) {
    console.log(`${t.cosine_similarity.toFixed(4)}  [${t.article_a_id}] ${t.a_title.slice(0, 40)}  ↔  [${t.article_b_id}] ${t.b_title.slice(0, 40)}`);
  }

  recordAudit(db, {
    entityType: 'cannibalization_pairs',
    entityId: 'bulk',
    action: 'create',
    after: { inserted, distribution: Object.fromEntries(histogram), thresholds: THRESHOLDS },
    actor: 'cli:pair-similarity',
    reason: 'Phase 2 Step 6',
  });

  logger.info({ inserted }, 'pair-similarity done');
  closeDb();
}

main();
