/**
 * Phase 1 完成検証 (DoD §9 自動化版)。
 * SELECT 群を順次実行し、期待値との差分を表示する。
 */
import { closeDb, getDb } from '../src/lib/db.js';

type Check = {
  name: string;
  sql: string;
  predicate: (rows: unknown[]) => { ok: boolean; got: string };
};

const checks: Check[] = [
  {
    name: 'master_topics counts',
    sql: "SELECT topic_kind, COUNT(*) AS c FROM master_topics GROUP BY topic_kind",
    predicate: (rows) => {
      const m = new Map<string, number>();
      for (const r of rows as Array<{ topic_kind: string; c: number }>) m.set(r.topic_kind, r.c);
      const major = m.get('subtopic_major') ?? 0;
      const minor = m.get('subtopic_minor') ?? 0;
      const pillar = m.get('pillar') ?? 0;
      const vocab = m.get('vocabulary') ?? 0;
      const ok = major + pillar >= 7 && minor >= 50 && pillar === 1 && vocab >= 50;
      return {
        ok,
        got: `major=${major} minor=${minor} pillar=${pillar} vocabulary=${vocab}`,
      };
    },
  },
  {
    name: 'Pilot KW (D1×V1) = 22',
    sql: "SELECT COUNT(*) AS c FROM master_keywords WHERE subtopic_topic_id='D1' AND vocabulary_topic_id='V1'",
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c === 22, got: `${c}` };
    },
  },
  {
    name: 'master_articles = 434',
    sql: 'SELECT COUNT(*) AS c FROM master_articles',
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c === 434, got: `${c}` };
    },
  },
  {
    name: "category_quarantine='confirmed' = 5",
    sql: "SELECT COUNT(*) AS c FROM master_articles WHERE category_quarantine='confirmed'",
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c === 5, got: `${c}` };
    },
  },
  {
    name: "category_quarantine='pending' (5 in P1 / 0 after P2)",
    sql: "SELECT COUNT(*) AS c FROM master_articles WHERE category_quarantine='pending'",
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c === 5 || c === 0, got: `${c}` };
    },
  },
  {
    name: 'subtopic_topic_id assigned >= 380',
    sql: 'SELECT COUNT(*) AS c FROM master_articles WHERE subtopic_topic_id IS NOT NULL',
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c >= 380, got: `${c}` };
    },
  },
  {
    name: 'crawled body_text NOT NULL = 434',
    sql: 'SELECT COUNT(*) AS c FROM master_articles WHERE crawled_at IS NOT NULL AND body_text IS NOT NULL',
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c === 434, got: `${c}` };
    },
  },
  // ---------- Phase 2 (Semantic) ----------
  {
    name: '[P2] schema_migrations contains 0.2.0',
    sql: "SELECT COUNT(*) AS c FROM schema_migrations WHERE version = '0.2.0'",
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c === 1, got: `${c}` };
    },
  },
  {
    name: "[P2] in_scope+pending articles embedded",
    sql: `SELECT
            (SELECT COUNT(*) FROM master_articles WHERE category_quarantine != 'confirmed') AS expected,
            (SELECT COUNT(*) FROM master_articles WHERE article_embedding IS NOT NULL AND category_quarantine != 'confirmed') AS got`,
    predicate: (rows) => {
      const r = rows[0] as { expected: number; got: number };
      return { ok: r.got === r.expected, got: `${r.got}/${r.expected}` };
    },
  },
  {
    name: '[P2] business_relevance_score populated',
    sql: 'SELECT COUNT(*) AS c FROM master_articles WHERE business_relevance_score IS NOT NULL',
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c >= 425, got: `${c}` };
    },
  },
  {
    name: "[P2] pending resolved (== 0 still pending)",
    sql: "SELECT COUNT(*) AS c FROM master_articles WHERE category_quarantine = 'pending'",
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c === 0, got: `${c}` };
    },
  },
  {
    name: '[P2] business_relevance_embeddings has v',
    sql: 'SELECT COUNT(*) AS c FROM business_relevance_embeddings',
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c >= 1, got: `${c}` };
    },
  },
  {
    name: '[P2] topic centroids built (>= 100)',
    sql: 'SELECT COUNT(*) AS c FROM master_topics WHERE centroid_vector IS NOT NULL',
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c >= 100, got: `${c}` };
    },
  },
  {
    name: '[P2] cannibalization_pairs has high-severity entries',
    sql: "SELECT COUNT(*) AS c FROM cannibalization_pairs WHERE severity = 'high'",
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c >= 100, got: `${c}` };
    },
  },
  {
    name: '[P2] gsc_query_url_snapshots populated',
    sql: 'SELECT COUNT(*) AS c, COUNT(DISTINCT article_id) AS articles FROM gsc_query_url_snapshots',
    predicate: (rows) => {
      const r = rows[0] as { c: number; articles: number };
      return { ok: r.c >= 10_000 && r.articles >= 400, got: `rows=${r.c} articles=${r.articles}` };
    },
  },
  {
    name: '[P2] article_performance_snapshots aggregated',
    sql: 'SELECT COUNT(*) AS c FROM article_performance_snapshots',
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c >= 400, got: `${c}` };
    },
  },
  {
    name: '[P2] cannibalization_pairs serp_overlap evaluated (>=20)',
    sql: 'SELECT COUNT(*) AS c FROM cannibalization_pairs WHERE serp_overlap_pct IS NOT NULL',
    predicate: (rows) => {
      const c = (rows[0] as { c: number }).c;
      return { ok: c >= 20, got: `${c}` };
    },
  },
];

function main() {
  const db = getDb();
  let failed = 0;
  for (const c of checks) {
    const rows = db.prepare(c.sql).all();
    const r = c.predicate(rows);
    const sym = r.ok ? '✅' : '❌';
    console.log(`${sym} ${c.name}  →  ${r.got}`);
    if (!r.ok) failed++;
  }
  closeDb();
  console.log(`\nfailed checks: ${failed}/${checks.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
