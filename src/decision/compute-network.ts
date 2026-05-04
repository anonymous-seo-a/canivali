/**
 * カニバリペアのネットワークを構築 → Louvain でコミュニティ抽出 → JSON ファイルに保存。
 *
 * 出力: db/derived/network.json
 *  { nodes: [{id, label, subtopic, v, clicks, action, community}],
 *    edges: [{a, b, cosine}] }
 *
 * 使い方: npm run decide:network
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';

const COSINE_MIN = 0.9;

function main() {
  const db = getDb();
  const pairs = db
    .prepare(
      `SELECT cp.article_a_id, cp.article_b_id, cp.cosine_similarity,
              dl.action
         FROM cannibalization_pairs cp
         JOIN decision_log dl ON dl.pair_id = cp.pair_id
        WHERE cp.cosine_similarity >= ?`,
    )
    .all(COSINE_MIN) as Array<{ article_a_id: number; article_b_id: number; cosine_similarity: number; action: string }>;

  logger.info({ pairs: pairs.length, cosine_min: COSINE_MIN }, 'building graph');

  // ネットワークに含まれるノードを集約
  const ids = new Set<number>();
  for (const p of pairs) {
    ids.add(p.article_a_id);
    ids.add(p.article_b_id);
  }

  // 記事メタを取得
  const meta = db
    .prepare(
      `SELECT a.article_id, a.title, a.url,
              a.subtopic_topic_id AS subtopic, a.vocabulary_topic_id AS v,
              COALESCE(p.clicks, 0) AS clicks
         FROM master_articles a
    LEFT JOIN article_performance_snapshots p ON p.article_id = a.article_id AND p.window_days = 90
        WHERE a.article_id IN (${[...ids].join(',') || 'NULL'})`,
    )
    .all() as Array<{
    article_id: number;
    title: string;
    url: string;
    subtopic: string | null;
    v: string | null;
    clicks: number;
  }>;
  const metaMap = new Map(meta.map((m) => [m.article_id, m]));

  // ノードごとの代表 action (最頻 or CONSOLIDATE 優先)
  const actionCount = new Map<number, Record<string, number>>();
  for (const p of pairs) {
    for (const id of [p.article_a_id, p.article_b_id]) {
      const m = actionCount.get(id) ?? {};
      m[p.action] = (m[p.action] ?? 0) + 1;
      actionCount.set(id, m);
    }
  }
  const dominantAction = (id: number): string => {
    const m = actionCount.get(id) ?? {};
    if (m.CONSOLIDATE && m.CONSOLIDATE > 0) return 'CONSOLIDATE';
    if (m.MANUAL_REVIEW && m.MANUAL_REVIEW > 0) return 'MANUAL_REVIEW';
    if (m.DIFFERENTIATE && m.DIFFERENTIATE > 0) return 'DIFFERENTIATE';
    return 'KEEP';
  };

  // graphology グラフ構築
  const g = new Graph({ type: 'undirected' });
  for (const id of ids) {
    const m = metaMap.get(id);
    g.addNode(String(id), {
      title: m?.title ?? '',
      url: m?.url ?? '',
      subtopic: m?.subtopic ?? '',
      v: m?.v ?? '',
      clicks: m?.clicks ?? 0,
      action: dominantAction(id),
    });
  }
  for (const p of pairs) {
    const a = String(p.article_a_id);
    const b = String(p.article_b_id);
    if (g.hasEdge(a, b)) continue; // 安全
    g.addEdge(a, b, { cosine: p.cosine_similarity });
  }

  // Louvain でコミュニティ抽出
  louvain.assign(g, { resolution: 1.0 });

  const nodes = g.mapNodes((node, attr) => ({
    id: Number(node),
    title: attr.title as string,
    url: attr.url as string,
    subtopic: attr.subtopic as string,
    v: attr.v as string,
    clicks: attr.clicks as number,
    action: attr.action as string,
    community: attr.community as number,
  }));
  const edges = g.mapEdges((_edge, attr, src, tgt) => ({
    a: Number(src),
    b: Number(tgt),
    cosine: attr.cosine as number,
  }));

  const outDir = resolve('db/derived');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'network.json');
  writeFileSync(outPath, JSON.stringify({ nodes, edges, computed_at: Date.now() }, null, 0));
  logger.info({ nodes: nodes.length, edges: edges.length, file: outPath }, 'network saved');

  const communityCount = new Set(nodes.map((n) => n.community)).size;
  console.log(`=== network ===`);
  console.log(`  nodes: ${nodes.length}`);
  console.log(`  edges: ${edges.length}`);
  console.log(`  communities: ${communityCount}`);

  recordAudit(db, {
    entityType: 'master_articles',
    entityId: 'network',
    action: 'create',
    after: { nodes: nodes.length, edges: edges.length, communities: communityCount, cosine_min: COSINE_MIN },
    actor: 'cli:compute-network',
    reason: 'Phase 3-A network + Louvain',
  });

  closeDb();
}

main();
