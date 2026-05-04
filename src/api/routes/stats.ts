import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Router } from 'express';
import { getDb } from '../../lib/db.js';

export const statsRouter: Router = Router();

statsRouter.get('/overview', (_req, res) => {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM master_articles').get() as { c: number }).c;
  const inScope = (db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE category_quarantine='in_scope'").get() as { c: number }).c;
  const confirmed = (db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE category_quarantine='confirmed'").get() as { c: number }).c;
  const consolidated = (db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE status='consolidated'").get() as { c: number }).c;
  const embedded = (db.prepare("SELECT COUNT(*) AS c FROM master_articles WHERE article_embedding IS NOT NULL").get() as { c: number }).c;

  const pairs = db.prepare(
    `SELECT severity, COUNT(*) AS c FROM cannibalization_pairs GROUP BY severity ORDER BY severity`,
  ).all();
  const pairRelations = db.prepare(
    `SELECT pair_relation, COUNT(*) AS c FROM cannibalization_pairs GROUP BY pair_relation ORDER BY c DESC`,
  ).all();
  const decisions = db.prepare(
    `SELECT action, COUNT(*) AS c, ROUND(AVG(confidence_score),3) AS avg_conf
       FROM decision_log GROUP BY action ORDER BY c DESC`,
  ).all();

  res.json({
    articles: { total, inScope, confirmed, consolidated, embedded },
    pairs,
    pairRelations,
    decisions,
  });
});

statsRouter.get('/cosine-histogram', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         ROUND(cosine_similarity * 100) / 100.0 AS bucket,
         COUNT(*) AS c
       FROM cannibalization_pairs
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all();
  res.json(rows);
});

statsRouter.get('/relevance-histogram', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         CASE
           WHEN business_relevance_score >= 0.78 THEN '0.78+'
           WHEN business_relevance_score >= 0.74 THEN '0.74-0.78'
           WHEN business_relevance_score >= 0.70 THEN '0.70-0.74'
           WHEN business_relevance_score >= 0.66 THEN '0.66-0.70'
           WHEN business_relevance_score >= 0.62 THEN '0.62-0.66'
           WHEN business_relevance_score >= 0.58 THEN '0.58-0.62'
           ELSE '<0.58'
         END AS bucket,
         COUNT(*) AS c
       FROM master_articles
       WHERE business_relevance_score IS NOT NULL
       GROUP BY bucket
       ORDER BY bucket DESC`,
    )
    .all();
  res.json(rows);
});

statsRouter.get('/top-cells', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT subtopic_topic_id AS subtopic, vocabulary_topic_id AS vocab,
              COUNT(*) AS articles
         FROM master_articles
        WHERE category_quarantine != 'confirmed'
        GROUP BY subtopic, vocab
        HAVING COUNT(*) > 1
        ORDER BY articles DESC
        LIMIT 30`,
    )
    .all();
  res.json(rows);
});

statsRouter.get('/top-articles', (_req, res) => {
  const db = getDb();
  const window = Number((_req.query as { window?: string }).window ?? 90);
  const limit = Math.min(Number((_req.query as { limit?: string }).limit ?? 20), 100);
  const rows = db
    .prepare(
      `SELECT a.article_id, a.url, a.title, a.subtopic_topic_id, a.vocabulary_topic_id,
              a.business_relevance_score,
              p.clicks, p.impressions, p.ctr, p.avg_position
         FROM master_articles a
    LEFT JOIN article_performance_snapshots p
           ON p.article_id = a.article_id AND p.window_days = ?
        WHERE a.category_quarantine != 'confirmed'
        ORDER BY p.clicks DESC NULLS LAST
        LIMIT ?`,
    )
    .all(window, limit);
  res.json(rows);
});

statsRouter.get('/heatmap-cells', (_req, res) => {
  // subtopic × V軸 のセル集約: 記事数 / clicks / カニバリ率 / 上位タイトル
  const db = getDb();

  // 記事集約 (90日 GSC)
  const articleAgg = db
    .prepare(
      `SELECT a.subtopic_topic_id AS subtopic, a.vocabulary_topic_id AS v,
              COUNT(*) AS articles,
              SUM(COALESCE(p.clicks, 0))      AS clicks,
              SUM(COALESCE(p.impressions, 0)) AS impressions,
              GROUP_CONCAT(a.article_id || '|||' || substr(a.title, 1, 60), '###') AS top_titles_raw
         FROM master_articles a
    LEFT JOIN article_performance_snapshots p ON p.article_id = a.article_id AND p.window_days = 90
        WHERE a.category_quarantine != 'confirmed'
          AND a.subtopic_topic_id IS NOT NULL
          AND a.vocabulary_topic_id IS NOT NULL
        GROUP BY subtopic, v`,
    )
    .all() as Array<{
    subtopic: string;
    v: string;
    articles: number;
    clicks: number;
    impressions: number;
    top_titles_raw: string;
  }>;

  // カニバリ率 (CONSOLIDATE + MANUAL_REVIEW のペア / セル内の理論最大ペア数)
  const cannibalAgg = db
    .prepare(
      `SELECT a.subtopic_topic_id AS subtopic, a.vocabulary_topic_id AS v,
              SUM(CASE WHEN dl.action IN ('CONSOLIDATE','MANUAL_REVIEW') THEN 1 ELSE 0 END) AS canniba_pairs
         FROM cannibalization_pairs cp
         JOIN master_articles a ON a.article_id = cp.article_a_id
         JOIN master_articles b ON b.article_id = cp.article_b_id
         JOIN decision_log dl ON dl.pair_id = cp.pair_id
        WHERE a.subtopic_topic_id = b.subtopic_topic_id
          AND a.vocabulary_topic_id = b.vocabulary_topic_id
          AND a.category_quarantine != 'confirmed'
          AND b.category_quarantine != 'confirmed'
        GROUP BY subtopic, v`,
    )
    .all() as Array<{ subtopic: string; v: string; canniba_pairs: number }>;
  const canMap = new Map<string, number>();
  for (const c of cannibalAgg) canMap.set(`${c.subtopic}|${c.v}`, c.canniba_pairs);

  // master_topics のラベルマップ (表示用)
  const topicLabels = db
    .prepare("SELECT topic_id, name FROM master_topics WHERE topic_kind IN ('subtopic_minor','vocabulary')")
    .all() as Array<{ topic_id: string; name: string }>;
  const labelMap = new Map<string, string>();
  for (const t of topicLabels) labelMap.set(t.topic_id, t.name);

  const cells = articleAgg.map((r) => {
    const key = `${r.subtopic}|${r.v}`;
    const cannibaPairs = canMap.get(key) ?? 0;
    const maxPairs = (r.articles * (r.articles - 1)) / 2;
    const cannibaRate = maxPairs > 0 ? cannibaPairs / maxPairs : 0;
    const topTitles = (r.top_titles_raw ?? '')
      .split('###')
      .filter(Boolean)
      .slice(0, 3)
      .map((entry) => {
        const [id, title] = entry.split('|||');
        return { article_id: Number(id), title: title ?? '' };
      });
    return {
      subtopic: r.subtopic,
      v: r.v,
      subtopic_label: labelMap.get(r.subtopic) ?? r.subtopic,
      v_label: labelMap.get(r.v) ?? r.v,
      articles: r.articles,
      clicks: r.clicks,
      impressions: r.impressions,
      canniba_pairs: cannibaPairs,
      canniba_rate: Math.round(cannibaRate * 1000) / 1000,
      top_titles: topTitles,
    };
  });

  res.json({ cells });
});

statsRouter.get('/cell/:subtopic/:v', (req, res) => {
  // セル内の記事一覧 + カニバリペア
  const db = getDb();
  const sub = req.params.subtopic;
  const v = req.params.v;

  const articles = db
    .prepare(
      `SELECT a.article_id, a.url, a.title, a.business_relevance_score,
              a.internal_links_in, a.unique_brands_count,
              p.clicks, p.impressions, p.avg_position
         FROM master_articles a
    LEFT JOIN article_performance_snapshots p ON p.article_id = a.article_id AND p.window_days = 90
        WHERE a.subtopic_topic_id = ?
          AND a.vocabulary_topic_id = ?
          AND a.category_quarantine != 'confirmed'
        ORDER BY p.clicks DESC NULLS LAST`,
    )
    .all(sub, v);

  const pairs = db
    .prepare(
      `SELECT cp.pair_id, cp.article_a_id, cp.article_b_id, cp.cosine_similarity,
              cp.kw_jaccard, cp.kw_overlap_count, cp.winner_article_id,
              dl.action, dl.confidence_score
         FROM cannibalization_pairs cp
         JOIN master_articles a ON a.article_id = cp.article_a_id
         JOIN master_articles b ON b.article_id = cp.article_b_id
         JOIN decision_log dl ON dl.pair_id = cp.pair_id
        WHERE a.subtopic_topic_id = ? AND a.vocabulary_topic_id = ?
          AND b.subtopic_topic_id = ? AND b.vocabulary_topic_id = ?
        ORDER BY cp.cosine_similarity DESC`,
    )
    .all(sub, v, sub, v);

  res.json({ articles, pairs });
});

statsRouter.get('/lift-report', (_req, res) => {
  const db = getDb();
  const items = db
    .prepare(
      `SELECT ce.execution_id, ce.pair_id, ce.executed_at, ce.observed_at,
              ce.baseline_combined_clicks, ce.baseline_combined_imps,
              ce.observed_winner_clicks, ce.observed_winner_imps, ce.observed_winner_pos,
              ce.lift_clicks_pct, ce.lift_imps_pct, ce.lift_status,
              wa.url AS winner_url, wa.title AS winner_title,
              la.url AS loser_url,  la.title AS loser_title
         FROM consolidation_executions ce
         JOIN master_articles wa ON wa.article_id = ce.winner_article_id
         JOIN master_articles la ON la.article_id = ce.loser_article_id
        ORDER BY ce.executed_at DESC
        LIMIT 200`,
    )
    .all();

  const summary = db
    .prepare(
      `SELECT lift_status, COUNT(*) AS c,
              ROUND(AVG(lift_clicks_pct),3) AS avg_clicks_lift,
              ROUND(AVG(lift_imps_pct),3) AS avg_imps_lift
         FROM consolidation_executions
        GROUP BY lift_status`,
    )
    .all();

  res.json({ items, summary });
});

// ===== Phase 2-A: UMAP coords =====
statsRouter.get('/umap', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.article_id, a.url, a.title,
              a.subtopic_topic_id AS subtopic, a.vocabulary_topic_id AS v,
              a.umap_x, a.umap_y, a.business_relevance_score,
              a.top_queries_json,
              COALESCE(p.clicks, 0) AS clicks,
              COALESCE(p.impressions, 0) AS impressions,
              COALESCE(p.avg_position, 0) AS avg_position
         FROM master_articles a
    LEFT JOIN article_performance_snapshots p ON p.article_id = a.article_id AND p.window_days = 90
        WHERE a.umap_x IS NOT NULL
          AND a.category_quarantine != 'confirmed'`,
    )
    .all() as Array<Record<string, unknown>>;
  res.json({ points: rows });
});

statsRouter.get('/umap-edges', (req, res) => {
  // 高 cosine ペアのリンク (UMAP 上に重ね描き用)
  const db = getDb();
  const minCos = Number((req.query as { min?: string }).min ?? 0.9);
  const rows = db
    .prepare(
      `SELECT cp.article_a_id, cp.article_b_id, cp.cosine_similarity
         FROM cannibalization_pairs cp
        WHERE cp.cosine_similarity >= ?
        LIMIT 5000`,
    )
    .all(minCos) as Array<{ article_a_id: number; article_b_id: number; cosine_similarity: number }>;
  res.json({ edges: rows, min: minCos });
});

// ===== Phase 2-B: Sankey (KW → subtopic → article) =====
statsRouter.get('/kw-sankey', (req, res) => {
  const db = getDb();
  const minImp = Number((req.query as { min_imp?: string }).min_imp ?? 100);
  const topKw = Math.min(Number((req.query as { top_kw?: string }).top_kw ?? 50), 200);
  const topArt = Math.min(Number((req.query as { top_art?: string }).top_art ?? 30), 100);
  const onlyDistributed = (req.query as { distributed?: string }).distributed === '1';

  // 上位 KW を選定
  let kwQuery = `
    SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS imps,
           COUNT(DISTINCT article_id) AS pages
      FROM gsc_query_url_snapshots
     WHERE window_days = 90
     GROUP BY query
    HAVING imps >= ?
  `;
  if (onlyDistributed) kwQuery += ' AND pages >= 2';
  kwQuery += ' ORDER BY clicks DESC LIMIT ?';
  const topKws = db.prepare(kwQuery).all(minImp, topKw) as Array<{
    query: string;
    clicks: number;
    imps: number;
    pages: number;
  }>;
  if (topKws.length === 0) {
    res.json({ nodes: [], links: [] });
    return;
  }

  const kwSet = new Set(topKws.map((k) => k.query));
  const placeholders = topKws.map(() => '?').join(',');

  // KW × URL × subtopic を取得 (上位 article は別途絞り込み)
  const flow = db
    .prepare(
      `SELECT g.query, g.article_id, g.clicks, g.avg_position,
              a.title, a.subtopic_topic_id AS subtopic
         FROM gsc_query_url_snapshots g
         JOIN master_articles a ON a.article_id = g.article_id
        WHERE g.window_days = 90
          AND g.query IN (${placeholders})
          AND a.category_quarantine != 'confirmed'`,
    )
    .all(...topKws.map((k) => k.query)) as Array<{
    query: string;
    article_id: number;
    clicks: number;
    avg_position: number;
    title: string;
    subtopic: string | null;
  }>;

  // 上位 article を選定 (clicks 合計順)
  const articleClicks = new Map<number, number>();
  for (const f of flow) articleClicks.set(f.article_id, (articleClicks.get(f.article_id) ?? 0) + f.clicks);
  const topArticles = [...articleClicks.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topArt)
    .map(([id]) => id);
  const articleSet = new Set(topArticles);

  // ノード索引
  const nodeIdx = new Map<string, number>();
  const nodes: Array<{ name: string; type: string }> = [];
  const node = (name: string, type: string): number => {
    const k = `${type}:${name}`;
    let idx = nodeIdx.get(k);
    if (idx === undefined) {
      idx = nodes.length;
      nodes.push({ name, type });
      nodeIdx.set(k, idx);
    }
    return idx;
  };

  // KW → subtopic 集約
  const links: Array<{ source: number; target: number; value: number; color: string }> = [];
  const kwSubAgg = new Map<string, number>();
  const subArtAgg = new Map<string, { value: number; pos: number }>();
  for (const f of flow) {
    if (!kwSet.has(f.query)) continue;
    if (!articleSet.has(f.article_id)) continue;
    if (!f.subtopic) continue;
    if (f.clicks <= 0) continue;
    const k1 = `${f.query}|${f.subtopic}`;
    kwSubAgg.set(k1, (kwSubAgg.get(k1) ?? 0) + f.clicks);
    const k2 = `${f.subtopic}|${f.article_id}`;
    const cur = subArtAgg.get(k2) ?? { value: 0, pos: 0 };
    cur.value += f.clicks;
    cur.pos = f.avg_position; // 最後のものに上書き; 簡略化
    subArtAgg.set(k2, cur);
  }

  for (const [k, v] of kwSubAgg) {
    const [query, sub] = k.split('|');
    if (!query || !sub) continue;
    links.push({ source: node(query, 'kw'), target: node(sub, 'sub'), value: v, color: 'rgba(120,120,200,0.4)' });
  }
  // article ノード
  const titleByArticle = new Map<number, string>();
  for (const f of flow) titleByArticle.set(f.article_id, f.title);
  for (const [k, v] of subArtAgg) {
    const [sub, aidStr] = k.split('|');
    if (!sub || !aidStr) continue;
    const aid = Number(aidStr);
    const title = `[${aid}] ${(titleByArticle.get(aid) ?? '').slice(0, 30)}`;
    const colour = v.pos <= 10 ? 'rgba(46,204,113,0.4)' : v.pos <= 20 ? 'rgba(243,156,18,0.4)' : 'rgba(231,76,60,0.4)';
    links.push({ source: node(sub, 'sub'), target: node(title, 'article'), value: v.value, color: colour });
  }

  res.json({ nodes, links });
});

// ===== Phase 3-A: Network graph =====
statsRouter.get('/network', (_req, res) => {
  const path = resolve('db/derived/network.json');
  if (!existsSync(path)) {
    res.json({ nodes: [], edges: [], stale: true });
    return;
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  res.json(data);
});

// ===== Phase 3-B: KW gap map =====
statsRouter.get('/kw-gap', (_req, res) => {
  const db = getDb();
  // GSC で impression があるが clicks=0 or 全 article が低トラの KW をリストアップ
  const rows = db
    .prepare(
      `SELECT g.query,
              SUM(g.impressions) AS imps,
              SUM(g.clicks) AS clicks,
              COUNT(DISTINCT g.article_id) AS pages,
              MIN(g.avg_position) AS best_pos
         FROM gsc_query_url_snapshots g
        WHERE g.window_days = 90
        GROUP BY g.query
       HAVING imps >= 50 AND clicks <= 1
        ORDER BY imps DESC
        LIMIT 100`,
    )
    .all();
  res.json({ items: rows });
});
