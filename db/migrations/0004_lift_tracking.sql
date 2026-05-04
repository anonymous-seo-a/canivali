-- =====================================================
-- Migration 0.4.0 — Lift verification tracking
-- =====================================================

-- 統合実行時のベースライン (実行直前 90日窓のスナップショット) を保存
CREATE TABLE IF NOT EXISTS consolidation_executions (
  execution_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id                   INTEGER NOT NULL,
  decision_id               INTEGER,
  loser_article_id          INTEGER NOT NULL,
  winner_article_id         INTEGER NOT NULL,
  executed_at               INTEGER NOT NULL,         -- unix timestamp

  -- ベースライン (実行直前)
  baseline_window_days      INTEGER NOT NULL,
  baseline_loser_clicks     INTEGER,
  baseline_loser_imps       INTEGER,
  baseline_winner_clicks    INTEGER,
  baseline_winner_imps      INTEGER,
  baseline_combined_clicks  INTEGER,
  baseline_combined_imps    INTEGER,

  -- 観測値 (T+28 で更新)
  observed_at               INTEGER,
  observed_winner_clicks    INTEGER,
  observed_winner_imps      INTEGER,
  observed_winner_pos       REAL,
  lift_clicks_pct           REAL,                     -- (observed_winner - baseline_combined) / baseline_combined
  lift_imps_pct             REAL,
  lift_status               TEXT DEFAULT 'pending',   -- 'pending' / 'measured' / 'rolled_back'

  rationale_json            TEXT,
  created_at                INTEGER DEFAULT (strftime('%s','now')),
  updated_at                INTEGER DEFAULT (strftime('%s','now')),

  FOREIGN KEY (pair_id)         REFERENCES cannibalization_pairs(pair_id),
  FOREIGN KEY (loser_article_id)  REFERENCES master_articles(article_id),
  FOREIGN KEY (winner_article_id) REFERENCES master_articles(article_id)
);

CREATE INDEX IF NOT EXISTS idx_consol_exec_pair  ON consolidation_executions(pair_id);
CREATE INDEX IF NOT EXISTS idx_consol_exec_lift  ON consolidation_executions(lift_status);
CREATE INDEX IF NOT EXISTS idx_consol_exec_when  ON consolidation_executions(executed_at);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0.4.0');
