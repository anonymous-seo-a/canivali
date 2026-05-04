-- =====================================================
-- master_topics: subtopic 軸 (A〜G) と中分類
-- 出典: docs/strategic/cardloan_topic_map.md §3
-- =====================================================

-- ----- A: 属性別借入 -----
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('A', 'subtopic_major', 'A', '属性別借入', '主語=人。self-identification 軸');

INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('A1', 'subtopic_minor', 'A', 'A', '雇用形態'),
  ('A2', 'subtopic_minor', 'A', 'A', '信用情報状態'),
  ('A3', 'subtopic_minor', 'A', 'A', '家族・婚姻'),
  ('A4', 'subtopic_minor', 'A', 'A', '職種特殊'),
  ('A5', 'subtopic_minor', 'A', 'A', '国籍・在留資格'),
  ('A6', 'subtopic_minor', 'A', 'A', '年齢・ライフステージ'),
  ('A7', 'subtopic_minor', 'A', 'A', '収入状態');

-- ----- B: 条件別借入 -----
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('B', 'subtopic_major', 'B', '条件別借入', '主語=商品スペック');

INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('B1', 'subtopic_minor', 'B', 'B', '即時性'),
  ('B2', 'subtopic_minor', 'B', 'B', '審査特殊'),
  ('B3', 'subtopic_minor', 'B', 'B', '金利・コスト'),
  ('B4', 'subtopic_minor', 'B', 'B', '借入金額帯'),
  ('B5', 'subtopic_minor', 'B', 'B', '借入手段・チャネル'),
  ('B6', 'subtopic_minor', 'B', 'B', '返済条件'),
  ('B7', 'subtopic_minor', 'B', 'B', '信用情報非依存系'),
  ('B8', 'subtopic_minor', 'B', 'B', 'バレ対策スペック');

-- ----- C: 目的別借入 -----
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('C', 'subtopic_major', 'C', '目的別借入', 'ユーザー動機');

INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('C1', 'subtopic_minor', 'C', 'C', '生活費・日常'),
  ('C2', 'subtopic_minor', 'C', 'C', '医療・健康'),
  ('C3', 'subtopic_minor', 'C', 'C', '引越・住居'),
  ('C4', 'subtopic_minor', 'C', 'C', '教育・養育'),
  ('C5', 'subtopic_minor', 'C', 'C', '冠婚葬祭'),
  ('C6', 'subtopic_minor', 'C', 'C', '借金関連'),
  ('C7', 'subtopic_minor', 'C', 'C', '緊急・突発'),
  ('C8', 'subtopic_minor', 'C', 'C', '趣味・娯楽'),
  ('C9', 'subtopic_minor', 'C', 'C', '事業・仕事');

-- ----- D: 比較・ランキング (ピラー / CV出口) -----
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('D', 'pillar', 'D', '比較・ランキング', 'subtopic配列の頂点・CV出口');

INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('D1', 'subtopic_minor', 'D', 'D', '商品比較ランキング'),
  ('D2', 'subtopic_minor', 'D', 'D', '軸別ランキング'),
  ('D3', 'subtopic_minor', 'D', 'D', '業態比較'),
  ('D4', 'subtopic_minor', 'D', 'D', '個社対決比較'),
  ('D5', 'subtopic_minor', 'D', 'D', '第三者評価'),
  ('D6', 'subtopic_minor', 'D', 'D', '困窮時総合ハブ'),
  ('D7', 'subtopic_minor', 'D', 'D', 'リテラシー・実態');

-- ----- E: 基礎知識・教養 -----
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('E', 'subtopic_major', 'E', '基礎知識・教養', '借入決定前');

INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('E1', 'subtopic_minor', 'E', 'E', '概念定義'),
  ('E2', 'subtopic_minor', 'E', 'E', '仕組み・構造'),
  ('E3', 'subtopic_minor', 'E', 'E', '審査の理解'),
  ('E4', 'subtopic_minor', 'E', 'E', 'メリット・デメリット'),
  ('E5', 'subtopic_minor', 'E', 'E', '法令・規制'),
  ('E6', 'subtopic_minor', 'E', 'E', '業界マップ');

-- ----- F: 実務・手続き -----
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('F', 'subtopic_major', 'F', '実務・手続き', '借入決定後');

INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('F1', 'subtopic_minor', 'F', 'F', '申込手順'),
  ('F2', 'subtopic_minor', 'F', 'F', '在籍確認実務'),
  ('F3', 'subtopic_minor', 'F', 'F', '審査プロセス実務'),
  ('F4', 'subtopic_minor', 'F', 'F', '借入実行'),
  ('F5', 'subtopic_minor', 'F', 'F', '返済実務'),
  ('F6', 'subtopic_minor', 'F', 'F', '限度額調整'),
  ('F7', 'subtopic_minor', 'F', 'F', '解約・退会');

-- ----- G: トラブル・相談 -----
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('G', 'subtopic_major', 'G', 'トラブル・相談', 'cardloan + 困難');

INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('G1', 'subtopic_minor', 'G', 'G', '返済困難'),
  ('G2', 'subtopic_minor', 'G', 'G', '督促・取立'),
  ('G3', 'subtopic_minor', 'G', 'G', '法的解決導線'),
  ('G4', 'subtopic_minor', 'G', 'G', '違法被害'),
  ('G5', 'subtopic_minor', 'G', 'G', '過払い金'),
  ('G6', 'subtopic_minor', 'G', 'G', 'ブラック後の生活'),
  ('G7', 'subtopic_minor', 'G', 'G', '第三者問題');

-- ----- 概念階層 (メタ情報): C (目的) > B (条件) -----
UPDATE master_topics SET conceptual_parent_id = 'C' WHERE topic_id = 'B';
