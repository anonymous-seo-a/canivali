-- =====================================================
-- cannibalization-system DB Schema v0.1
-- =====================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- -----------------------------------------------------
-- Strategic Layer: Topics & Vocabulary
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS master_topics (
  topic_id              TEXT PRIMARY KEY,
  topic_kind            TEXT NOT NULL,
  parent_topic_id       TEXT,
  axis_letter           TEXT,
  vocabulary_group      TEXT,
  name                  TEXT NOT NULL,
  description           TEXT,
  conceptual_parent_id  TEXT,
  centroid_vector       BLOB,
  centroid_updated_at   INTEGER,
  created_at            INTEGER DEFAULT (strftime('%s','now')),
  updated_at            INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (parent_topic_id) REFERENCES master_topics(topic_id)
);

CREATE INDEX IF NOT EXISTS idx_master_topics_kind   ON master_topics(topic_kind);
CREATE INDEX IF NOT EXISTS idx_master_topics_axis   ON master_topics(axis_letter);
CREATE INDEX IF NOT EXISTS idx_master_topics_parent ON master_topics(parent_topic_id);

CREATE TABLE IF NOT EXISTS master_keywords (
  keyword_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword                 TEXT NOT NULL,
  canonical_keyword_id    INTEGER,
  subtopic_topic_id       TEXT,
  vocabulary_topic_id     TEXT,
  intent_layer            TEXT,
  tier                    INTEGER,
  search_volume           INTEGER,
  status                  TEXT DEFAULT 'active',
  created_at              INTEGER DEFAULT (strftime('%s','now')),
  updated_at              INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE(keyword),
  FOREIGN KEY (canonical_keyword_id)  REFERENCES master_keywords(keyword_id),
  FOREIGN KEY (subtopic_topic_id)     REFERENCES master_topics(topic_id),
  FOREIGN KEY (vocabulary_topic_id)   REFERENCES master_topics(topic_id)
);

CREATE INDEX IF NOT EXISTS idx_master_keywords_canonical  ON master_keywords(canonical_keyword_id);
CREATE INDEX IF NOT EXISTS idx_master_keywords_subtopic   ON master_keywords(subtopic_topic_id);
CREATE INDEX IF NOT EXISTS idx_master_keywords_vocabulary ON master_keywords(vocabulary_topic_id);

-- -----------------------------------------------------
-- Article inventory
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS master_articles (
  article_id                  INTEGER PRIMARY KEY,
  url                         TEXT NOT NULL UNIQUE,
  title                       TEXT NOT NULL,
  body_hash                   TEXT,
  body_text                   TEXT,
  word_count                  INTEGER,
  publish_date                TEXT,
  last_modified               TEXT,
  status                      TEXT DEFAULT 'published',
  redirect_target_url         TEXT,

  subtopic_axis               TEXT,
  subtopic_topic_id           TEXT,
  vocabulary_topic_id         TEXT,
  classification_method       TEXT,
  classification_confidence   REAL,

  category_quarantine         TEXT DEFAULT 'in_scope',
  quarantine_reason           TEXT,

  article_embedding           BLOB,
  embedding_model             TEXT,
  embedding_updated_at        INTEGER,

  crawled_at                  INTEGER,
  created_at                  INTEGER DEFAULT (strftime('%s','now')),
  updated_at                  INTEGER DEFAULT (strftime('%s','now')),

  FOREIGN KEY (subtopic_topic_id)   REFERENCES master_topics(topic_id),
  FOREIGN KEY (vocabulary_topic_id) REFERENCES master_topics(topic_id)
);

CREATE INDEX IF NOT EXISTS idx_articles_subtopic   ON master_articles(subtopic_axis, subtopic_topic_id);
CREATE INDEX IF NOT EXISTS idx_articles_vocabulary ON master_articles(vocabulary_topic_id);
CREATE INDEX IF NOT EXISTS idx_articles_quarantine ON master_articles(category_quarantine);
CREATE INDEX IF NOT EXISTS idx_articles_status     ON master_articles(status);

CREATE TABLE IF NOT EXISTS article_keywords (
  article_id  INTEGER NOT NULL,
  keyword_id  INTEGER NOT NULL,
  source      TEXT,
  PRIMARY KEY (article_id, keyword_id),
  FOREIGN KEY (article_id) REFERENCES master_articles(article_id) ON DELETE CASCADE,
  FOREIGN KEY (keyword_id) REFERENCES master_keywords(keyword_id) ON DELETE CASCADE
);

-- -----------------------------------------------------
-- Performance snapshots (Phase 2+)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS article_performance_snapshots (
  snapshot_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id         INTEGER NOT NULL,
  snapshot_date      TEXT NOT NULL,
  window_days        INTEGER NOT NULL,

  clicks             INTEGER,
  impressions        INTEGER,
  ctr                REAL,
  avg_position       REAL,

  sessions           INTEGER,
  engaged_sessions   INTEGER,
  cv_count           INTEGER,
  cv_rate            REAL,

  dead_clicks        INTEGER,
  rage_clicks        INTEGER,
  scroll_depth_avg   REAL,

  created_at         INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (article_id) REFERENCES master_articles(article_id) ON DELETE CASCADE,
  UNIQUE(article_id, snapshot_date, window_days)
);

CREATE INDEX IF NOT EXISTS idx_perf_article ON article_performance_snapshots(article_id);
CREATE INDEX IF NOT EXISTS idx_perf_date    ON article_performance_snapshots(snapshot_date);

CREATE TABLE IF NOT EXISTS gsc_query_url_snapshots (
  snapshot_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id      INTEGER NOT NULL,
  query           TEXT NOT NULL,
  snapshot_date   TEXT NOT NULL,
  window_days     INTEGER NOT NULL,
  clicks          INTEGER,
  impressions     INTEGER,
  ctr             REAL,
  avg_position    REAL,
  created_at      INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (article_id) REFERENCES master_articles(article_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gsc_qu_article ON gsc_query_url_snapshots(article_id);
CREATE INDEX IF NOT EXISTS idx_gsc_qu_query   ON gsc_query_url_snapshots(query);
CREATE INDEX IF NOT EXISTS idx_gsc_qu_date    ON gsc_query_url_snapshots(snapshot_date);

-- -----------------------------------------------------
-- Cannibalization detection (Phase 2+)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS cannibalization_pairs (
  pair_id               INTEGER PRIMARY KEY AUTOINCREMENT,
  article_a_id          INTEGER NOT NULL,
  article_b_id          INTEGER NOT NULL,
  cosine_similarity     REAL,
  serp_overlap_pct      REAL,
  shared_queries_count  INTEGER,
  shared_queries_json   TEXT,
  severity              TEXT,
  detected_at           INTEGER DEFAULT (strftime('%s','now')),
  CHECK (article_a_id < article_b_id),
  UNIQUE(article_a_id, article_b_id),
  FOREIGN KEY (article_a_id) REFERENCES master_articles(article_id),
  FOREIGN KEY (article_b_id) REFERENCES master_articles(article_id)
);

-- -----------------------------------------------------
-- Decision log (Phase 3+)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS decision_log (
  decision_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id            INTEGER,
  pair_id               INTEGER,
  action                TEXT NOT NULL,
  target_url            TEXT,
  target_subtopic_id    TEXT,
  target_vocabulary_id  TEXT,
  confidence_score      REAL,
  human_reviewed        INTEGER DEFAULT 0,
  human_decision        TEXT,
  rationale_json        TEXT,
  decided_at            INTEGER DEFAULT (strftime('%s','now')),
  reviewed_at           INTEGER,
  executed_at           INTEGER,
  FOREIGN KEY (article_id) REFERENCES master_articles(article_id),
  FOREIGN KEY (pair_id)    REFERENCES cannibalization_pairs(pair_id)
);

-- -----------------------------------------------------
-- Audit log
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS master_audit_log (
  log_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  action              TEXT NOT NULL,
  before_state_json   TEXT,
  after_state_json    TEXT,
  actor               TEXT NOT NULL,
  reason              TEXT,
  created_at          INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity  ON master_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON master_audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_created ON master_audit_log(created_at);

-- -----------------------------------------------------
-- Migration history
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  INTEGER DEFAULT (strftime('%s','now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0.1.0');
