-- =====================================================
-- Migration 0.3.0 — Phase 3 (Decision) schema additions
-- =====================================================

-- ペア関係 (どの軸が一致しているか)
-- 'same_cell'              : subtopic + V 両方一致 = 強カニバリ
-- 'same_subtopic_diff_v'   : subtopic 同 / V 異
-- 'diff_subtopic_same_v'   : subtopic 異 / V 同 (商標違いで意図近接)
-- 'fully_different'        : 両軸異 (suspicious だが意図差別化の可能性)
-- 'unclassified'           : 片方or両方の subtopic/V が NULL
ALTER TABLE cannibalization_pairs ADD COLUMN pair_relation TEXT;
ALTER TABLE cannibalization_pairs ADD COLUMN winner_article_id INTEGER;
ALTER TABLE cannibalization_pairs ADD COLUMN winner_score REAL;
ALTER TABLE cannibalization_pairs ADD COLUMN winner_rationale_json TEXT;

CREATE INDEX IF NOT EXISTS idx_pairs_relation ON cannibalization_pairs(pair_relation);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0.3.0');
