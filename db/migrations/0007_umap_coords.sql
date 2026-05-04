-- =====================================================
-- Migration 0.7.0 — UMAP 2D coordinates for visualization
-- =====================================================

ALTER TABLE master_articles ADD COLUMN umap_x REAL;
ALTER TABLE master_articles ADD COLUMN umap_y REAL;
ALTER TABLE master_articles ADD COLUMN umap_updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_articles_umap ON master_articles(umap_x, umap_y);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0.7.0');
