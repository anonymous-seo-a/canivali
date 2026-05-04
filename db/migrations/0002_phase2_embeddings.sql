-- =====================================================
-- Migration 0.2.0 — Phase 2 (Semantic) schema additions
-- =====================================================

-- 北極星 (business_relevance.md) の embedding を保存
-- バージョン管理し、ステートメント変更時の再 embedding に対応
CREATE TABLE IF NOT EXISTS business_relevance_embeddings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  version         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  content_text    TEXT NOT NULL,
  embedding       BLOB NOT NULL,
  embedding_model TEXT NOT NULL,
  created_at      INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE(version, content_hash)
);

-- 各記事に北極星との cosine 類似度 (= 事業整合度スコア) を持たせる
ALTER TABLE master_articles ADD COLUMN business_relevance_score REAL;
ALTER TABLE master_articles ADD COLUMN business_relevance_version TEXT;

-- migration 履歴
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0.2.0');
