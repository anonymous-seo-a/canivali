-- =====================================================
-- Migration 0.5.0 — Top KW caching + KW jaccard gate
-- =====================================================

-- 各記事の top KW を JSON キャッシュ ([{query, clicks, impressions, position}, ...])
ALTER TABLE master_articles ADD COLUMN top_queries_json TEXT;
ALTER TABLE master_articles ADD COLUMN top_queries_updated_at INTEGER;

-- ペアの KW jaccard (両者の top-K 集合の jaccard 類似度) と
-- 共通 KW 数 (impressions ≥ 5 で両者にあるもの)
ALTER TABLE cannibalization_pairs ADD COLUMN kw_jaccard REAL;
ALTER TABLE cannibalization_pairs ADD COLUMN kw_overlap_count INTEGER;
ALTER TABLE cannibalization_pairs ADD COLUMN kw_a_only_count INTEGER;
ALTER TABLE cannibalization_pairs ADD COLUMN kw_b_only_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_pairs_kw_jaccard ON cannibalization_pairs(kw_jaccard);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0.5.0');
