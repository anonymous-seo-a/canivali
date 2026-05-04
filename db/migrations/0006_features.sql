-- =====================================================
-- Migration 0.6.0 — Phase 6 winner signals + article features
-- =====================================================

-- 内部リンク数 (この記事を本文中で参照している他記事の数)
ALTER TABLE master_articles ADD COLUMN internal_links_in INTEGER DEFAULT 0;

-- ブランド (商品軸) の本文出現多様性
ALTER TABLE master_articles ADD COLUMN unique_brands_count   INTEGER DEFAULT 0;
ALTER TABLE master_articles ADD COLUMN total_brand_mentions  INTEGER DEFAULT 0;

-- URL 品質スコア (短さ・スラッグ意味性) と新鮮さ
ALTER TABLE master_articles ADD COLUMN url_quality_score  REAL DEFAULT 0;
ALTER TABLE master_articles ADD COLUMN freshness_score    REAL DEFAULT 0;

-- consolidate-winner として何回吸収するか (ハブ判定用)
ALTER TABLE master_articles ADD COLUMN consolidate_winner_count INTEGER DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0.6.0');
