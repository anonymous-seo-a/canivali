/**
 * Phase 6: 各記事の追加メトリクス計算
 *  - internal_links_in: この記事 URL が他記事の本文中に何回リンクされているか
 *  - unique_brands_count / total_brand_mentions: ブランド出現の多様性
 *  - url_quality_score: スラッグ短さ・意味的さ (短い数字主体は低、長い意味語は高)
 *  - freshness_score: last_modified からの日数 (540日で 0、新しいほど 1)
 *
 * 使い方: npm run decide:features
 */
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';

const FRESHNESS_DECAY_DAYS = 540;

type Article = {
  article_id: number;
  url: string;
  title: string;
  body_text: string | null;
  last_modified: string | null;
};

function computeUrlQuality(url: string): number {
  // /no1/news/cardloan/<slug>
  const m = url.match(/\/cardloan\/([^/]+?)\/?$/);
  if (!m || !m[1]) return 0.3;
  const slug = m[1];
  // 数字だけのスラッグは低、英字混じりや日本語スラッグは高
  const isPureNumeric = /^\d+$/.test(slug);
  if (isPureNumeric) return 0.3;
  const len = slug.length;
  if (len <= 6) return 0.5;
  if (len <= 12) return 0.7;
  if (len <= 25) return 0.9;
  return 0.6; // 長すぎは減点
}

function computeFreshness(lastModified: string | null): number {
  if (!lastModified) return 0;
  const mod = new Date(lastModified).getTime();
  if (Number.isNaN(mod)) return 0;
  const days = (Date.now() - mod) / 86_400_000;
  if (days <= 0) return 1;
  return Math.max(0, 1 - days / FRESHNESS_DECAY_DAYS);
}

function loadBrands(db: ReturnType<typeof getDb>): Array<{ topic_id: string; name: string }> {
  return db
    .prepare(
      `SELECT topic_id, name FROM master_topics
        WHERE vocabulary_group = 'product_brand'
          AND topic_id LIKE '%-%'`,
    )
    .all() as Array<{ topic_id: string; name: string }>;
}

function brandMentions(body: string, brands: Array<{ name: string }>): { unique: number; total: number } {
  if (!body) return { unique: 0, total: 0 };
  const seen = new Set<string>();
  let total = 0;
  for (const b of brands) {
    if (!b.name) continue;
    // 日本語の正確一致 (= 余分な空白を除去)
    const re = new RegExp(b.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const ms = body.match(re);
    if (ms && ms.length > 0) {
      seen.add(b.name);
      total += ms.length;
    }
  }
  return { unique: seen.size, total };
}

function computeInternalLinks(db: ReturnType<typeof getDb>): Map<number, number> {
  const articles = db
    .prepare(`SELECT article_id, url, body_text FROM master_articles WHERE body_text IS NOT NULL`)
    .all() as Array<{ article_id: number; url: string; body_text: string }>;

  const idByUrl = new Map<string, number>();
  for (const a of articles) {
    idByUrl.set(a.url, a.article_id);
    // 末尾スラッシュ違いも吸収
    if (a.url.endsWith('/')) idByUrl.set(a.url.slice(0, -1), a.article_id);
    else idByUrl.set(`${a.url}/`, a.article_id);
  }

  const incoming = new Map<number, number>();
  // body_text には抽出時に URL 文字列が残っているはず (cheerio で text() 抽出時 a要素の href も a要素のテキストには含まれない)
  // → 我々の body_text からは URL を発見できない可能性が高い。代替: title 文字列の出現を数える。
  // → さらに代替: WP REST から HTML を取得して link を数える。今回は title-mention で代替。
  const titleByArticle = new Map<number, string>();
  for (const a of articles) titleByArticle.set(a.article_id, '');
  const titleRow = db
    .prepare('SELECT article_id, title FROM master_articles')
    .all() as Array<{ article_id: number; title: string }>;
  for (const t of titleRow) titleByArticle.set(t.article_id, t.title);

  // 簡易的な内部リンクプロキシ:
  //   各記事の本文に他記事の **タイトル先頭 12 文字** が出現する数 = 内部参照プロキシ
  for (const src of articles) {
    for (const [tgtId, tgtTitle] of titleByArticle) {
      if (tgtId === src.article_id) continue;
      const probe = tgtTitle.slice(0, 12);
      if (probe.length < 8) continue;
      if (src.body_text.includes(probe)) {
        incoming.set(tgtId, (incoming.get(tgtId) ?? 0) + 1);
      }
    }
  }
  return incoming;
}

function main() {
  const db = getDb();
  const articles = db
    .prepare(
      `SELECT article_id, url, title, body_text, last_modified
         FROM master_articles WHERE body_text IS NOT NULL`,
    )
    .all() as Article[];

  const brands = loadBrands(db);
  logger.info({ articles: articles.length, brands: brands.length }, 'features compute begin');

  // 1) brand mentions + url quality + freshness
  const update = db.prepare(
    `UPDATE master_articles SET
       unique_brands_count   = @unique_brands,
       total_brand_mentions  = @total_brands,
       url_quality_score     = @url_q,
       freshness_score       = @fresh
     WHERE article_id = @article_id`,
  );

  const tx1 = db.transaction(() => {
    for (const a of articles) {
      const m = brandMentions(a.body_text ?? '', brands);
      update.run({
        article_id: a.article_id,
        unique_brands: m.unique,
        total_brands: m.total,
        url_q: computeUrlQuality(a.url),
        fresh: computeFreshness(a.last_modified),
      });
    }
  });
  tx1();

  // 2) internal_links_in (heuristic: title-string mention proxy)
  const inLinks = computeInternalLinks(db);
  const updateLinks = db.prepare('UPDATE master_articles SET internal_links_in = ? WHERE article_id = ?');
  const tx2 = db.transaction(() => {
    for (const [id, count] of inLinks) updateLinks.run(count, id);
  });
  tx2();

  // 3) consolidate_winner_count (今の decision_log から計算)
  db.exec(`UPDATE master_articles SET consolidate_winner_count = 0`);
  const updWinner = db.prepare(
    `UPDATE master_articles SET consolidate_winner_count = (
       SELECT COUNT(*) FROM cannibalization_pairs cp
         JOIN decision_log dl ON dl.pair_id = cp.pair_id AND dl.action='CONSOLIDATE'
        WHERE cp.winner_article_id = master_articles.article_id
     )`,
  );
  updWinner.run();

  // サマリ
  const summary = db
    .prepare(
      `SELECT
         AVG(unique_brands_count) AS avg_brands,
         AVG(total_brand_mentions) AS avg_mentions,
         AVG(internal_links_in) AS avg_in_links,
         AVG(url_quality_score) AS avg_url_q,
         AVG(freshness_score) AS avg_fresh,
         MAX(consolidate_winner_count) AS max_winner
       FROM master_articles WHERE body_text IS NOT NULL`,
    )
    .get();
  console.log('=== article features summary ===');
  console.log(summary);
  const hubs = db
    .prepare(
      `SELECT article_id, substr(title,1,40) AS title, internal_links_in, consolidate_winner_count
         FROM master_articles
        WHERE consolidate_winner_count >= 3 OR internal_links_in >= 20
        ORDER BY consolidate_winner_count DESC, internal_links_in DESC
        LIMIT 10`,
    )
    .all();
  console.log('=== hub articles (top) ===');
  for (const h of hubs as Array<{ article_id: number; title: string; internal_links_in: number; consolidate_winner_count: number }>) {
    console.log(`  [${h.article_id}] winners=${h.consolidate_winner_count} in=${h.internal_links_in} ${h.title}`);
  }

  recordAudit(db, {
    entityType: 'master_articles',
    entityId: 'features',
    action: 'update',
    after: { processed: articles.length, summary },
    actor: 'cli:article-features',
    reason: 'Phase 6 feature computation',
  });

  closeDb();
}

main();
