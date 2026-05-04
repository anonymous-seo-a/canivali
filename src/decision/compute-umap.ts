/**
 * 全 in_scope 記事の embedding (1024dim) を 2D に圧縮し、
 * master_articles.umap_x / umap_y に保存する。
 *
 * 名称は umap だが実装は PCA (power iteration via covariance) を採用:
 *   - umap-js は 429 vectors × 1024 dim で 30 分超かかった (ブラウザ運用に不適)
 *   - PCA は < 1秒、構造保存も視覚化用途には十分
 *   - 将来 GPU/native UMAP が用意できれば切替可
 *
 * 使い方: npm run decide:umap
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { blobToVector } from '../lib/voyage.js';

const DIM = 1024;
const POWER_ITER = 20;

function meanCenter(matrix: Float32Array[]): { mean: Float32Array; centered: Float32Array[] } {
  const mean = new Float32Array(DIM);
  for (const row of matrix) {
    for (let i = 0; i < DIM; i++) mean[i]! += row[i] ?? 0;
  }
  for (let i = 0; i < DIM; i++) mean[i]! /= matrix.length;
  const centered = matrix.map((row) => {
    const r = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) r[i] = (row[i] ?? 0) - mean[i]!;
    return r;
  });
  return { mean, centered };
}

function l2Normalize(v: Float32Array): void {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) + 1e-12;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
}

function powerIterate(centered: Float32Array[]): { axis1: Float32Array; axis2: Float32Array } {
  // 第一主成分: ランダム初期化 → covariance multiplication で反復
  const ax1 = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) ax1[i] = Math.random() - 0.5;
  l2Normalize(ax1);
  for (let iter = 0; iter < POWER_ITER; iter++) {
    // X^T X v / |X^T X v|  (v = ax1)
    // step1: y = Xv  (n,)
    const y = new Float32Array(centered.length);
    for (let i = 0; i < centered.length; i++) {
      let s = 0;
      const row = centered[i]!;
      for (let j = 0; j < DIM; j++) s += row[j]! * ax1[j]!;
      y[i] = s;
    }
    // step2: u = X^T y  (DIM,)
    const u = new Float32Array(DIM);
    for (let i = 0; i < centered.length; i++) {
      const row = centered[i]!;
      const yi = y[i]!;
      for (let j = 0; j < DIM; j++) u[j]! += row[j]! * yi;
    }
    l2Normalize(u);
    for (let j = 0; j < DIM; j++) ax1[j] = u[j]!;
  }
  // 第二主成分: ax1 への射影を引いてから同じ反復
  const ax2 = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) ax2[i] = Math.random() - 0.5;
  l2Normalize(ax2);
  for (let iter = 0; iter < POWER_ITER; iter++) {
    // ax2 から ax1 成分を除去
    let dot = 0;
    for (let i = 0; i < DIM; i++) dot += ax2[i]! * ax1[i]!;
    for (let i = 0; i < DIM; i++) ax2[i]! -= dot * ax1[i]!;
    l2Normalize(ax2);
    // power iteration on residual
    const y = new Float32Array(centered.length);
    for (let i = 0; i < centered.length; i++) {
      let s = 0;
      const row = centered[i]!;
      for (let j = 0; j < DIM; j++) s += row[j]! * ax2[j]!;
      y[i] = s;
    }
    const u = new Float32Array(DIM);
    for (let i = 0; i < centered.length; i++) {
      const row = centered[i]!;
      const yi = y[i]!;
      for (let j = 0; j < DIM; j++) u[j]! += row[j]! * yi;
    }
    // remove ax1 component
    let d = 0;
    for (let i = 0; i < DIM; i++) d += u[i]! * ax1[i]!;
    for (let i = 0; i < DIM; i++) u[i]! -= d * ax1[i]!;
    l2Normalize(u);
    for (let j = 0; j < DIM; j++) ax2[j] = u[j]!;
  }
  return { axis1: ax1, axis2: ax2 };
}

function project(centered: Float32Array[], axis1: Float32Array, axis2: Float32Array): Array<[number, number]> {
  return centered.map((row) => {
    let x = 0;
    let y = 0;
    for (let j = 0; j < DIM; j++) {
      x += row[j]! * axis1[j]!;
      y += row[j]! * axis2[j]!;
    }
    return [x, y];
  });
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
    .all() as Array<{ article_id: number; article_embedding: Buffer }>;

  if (rows.length < 5) {
    logger.warn({ rows: rows.length }, 'too few articles');
    closeDb();
    return;
  }

  logger.info({ articles: rows.length }, 'computing PCA 2D');
  const t0 = Date.now();
  const matrix = rows.map((r) => blobToVector(r.article_embedding));
  const { centered } = meanCenter(matrix);
  const { axis1, axis2 } = powerIterate(centered);
  const coords = project(centered, axis1, axis2);
  logger.info({ ms: Date.now() - t0 }, 'PCA done');

  const update = db.prepare(
    `UPDATE master_articles SET umap_x = ?, umap_y = ?, umap_updated_at = strftime('%s','now') WHERE article_id = ?`,
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const c = coords[i];
      const r = rows[i];
      if (!c || !r) continue;
      update.run(c[0], c[1], r.article_id);
    }
  });
  tx();

  recordAudit(db, {
    entityType: 'master_articles',
    entityId: 'umap_pca',
    action: 'update',
    after: { rows: rows.length, dur_ms: Date.now() - t0, method: 'pca_power_iter' },
    actor: 'cli:compute-umap',
    reason: 'Phase 2-A coords (PCA fallback)',
  });

  console.log(`✓ ${rows.length} articles, took ${Date.now() - t0} ms`);
  closeDb();
}

main();
