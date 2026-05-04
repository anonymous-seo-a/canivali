# Phase 1: Foundation — Handoff Document v0.1

**対象**: Claude Code (cannibalization-system 実装担当)
**承認者**: Daiki
**作成日**: 2026-05-02
**完成期限目安**: 2週間

---

## 0. このドキュメントの位置づけ

cannibalization-system の Phase 1 (Foundation) を Claude Code に引き渡すための完全な実装指示書。本ドキュメントだけで以下が判断・実行できるレベルの情報を含む。

参照される他ファイル (必読):
- `docs/strategic/business_relevance.md` — 北極星ステートメント
- `docs/strategic/cardloan_topic_map.md` — subtopic + V軸の構造
- `docs/strategic/keyword_portfolios.md` — KW 生成ルール

Phase 1 が完了するまで Phase 2 (Semantic) には進まない。

---

## 1. プロジェクト概要

### 1.1 目的
soico の cardloan/ カテゴリ (434記事) のキーワードカニバリゼーション解消システムを構築する。Phase 1 ではデータ取り込み基盤と全記事のインベントリ化を完成させる。

### 1.2 アーキテクチャ階層 (Phase 1 の位置)

```
Phase 0 (Strategic) ✅ 完了
  └ docs/strategic/ 3ファイル

Phase 1 (Foundation) ← 今ここ
  ├ リポジトリ立ち上げ
  ├ DB schema 構築
  ├ データ取り込み基盤
  └ master_articles 初期登録 (429記事)

Phase 2 (Semantic) — 未着手
  ├ embedding 生成
  ├ topic centroid 計算
  └ cannibalization_pairs 抽出

Phase 3 (Decision) — 未着手
  ├ 5-fix 判定木
  ├ confidence 計算
  └ Human Review UI

Phase 4 (Pilot) — 未着手
  └ (D1×V1) カードローンおすすめ6件で効果検証
```

### 1.3 Phase 1 完成定義 (Definition of Done)

以下が**すべて**満たされた時点で Phase 1 完了:

1. ✅ リポジトリ `cannibalization-system` が GitHub に存在
2. ✅ ローカル開発環境で `npm run dev` が起動する
3. ✅ DB schema の全テーブルが `db/cannibalization.db` に作成済み
4. ✅ Strategic Layer 3ファイルが `docs/strategic/` に配置済み
5. ✅ master_topics テーブルに subtopic 軸 (A〜G の中分類) と V軸 (V1〜V16) が seed 済み
6. ✅ master_keywords テーブルに Pilot セル (D1×V1) の22主軸 KW が seed 済み
7. ✅ soico cardloan/ 434記事のクロール完了 (本文 + メタデータ取得)
8. ✅ master_articles に434記事登録完了
9. ✅ 確定汚染5件 (13904, 18818, 19347, 14130, 14148) に `category_quarantine = 'confirmed'` フラグ
10. ✅ 要判定5件 (17549, 14056, 14077, 22431, 22539) に `category_quarantine = 'pending'` フラグ
11. ✅ 各記事にタイトルベースの暫定 (subtopic_axis, vocabulary_axis) が割当済み
12. ✅ GSC / GA4 / Clarity / SerpAPI / Claude API / OpenAI API の認証確認済み (実データ pull は Phase 2)
13. ✅ Phase 2 への引き継ぎ事項が `docs/handoffs/phase2_semantic_handoff.md` に記述済み

---

## 2. Tech Stack 決定事項

| 層 | 採用 | バージョン |
|----|------|----------|
| Runtime | Node.js | 20 LTS 以上 |
| 言語 | TypeScript | 5.x |
| API | Express | 4.x |
| DB | better-sqlite3 | 11.x |
| UI | React + Vite | React 18 / Vite 5 |
| クロール | Playwright + cheerio | 最新 |
| HTTP client | undici (or fetch native) | Node 標準 |
| Claude API | @anthropic-ai/sdk | 最新 |
| OpenAI API | openai | 最新 |
| GSC | googleapis | 最新 |
| GA4 | @google-analytics/data | 最新 |
| Logger | pino | 最新 |
| ENV管理 | dotenv | 最新 |
| Lint/Format | biome | 最新 |
| Test | vitest | 最新 |

**Python 不可** (s-tools と同じ stack 統一原則)。embedding 計算は API 経由 (OpenAI) で十分。

---

## 3. リポジトリ構成 (確定版)

```
cannibalization-system/
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── biome.json
├── vitest.config.ts
│
├── docs/
│   ├── strategic/
│   │   ├── business_relevance.md
│   │   ├── cardloan_topic_map.md
│   │   └── keyword_portfolios.md
│   ├── handoffs/
│   │   ├── phase1_foundation_handoff.md  ← このファイル
│   │   └── phase2_semantic_handoff.md    ← Phase 1 完了時に Claude Code が作成
│   ├── architecture.md                    ← 3層アーキテクチャ図 (Daikiが別途指示する場合のみ)
│   └── runbooks/
│       ├── crawl_soico.md
│       ├── auth_gsc.md
│       └── recovery.md
│
├── db/
│   ├── schema.sql                         ← 本ドキュメント §5 をそのまま転記
│   ├── seeds/
│   │   ├── 01_master_topics.sql           ← subtopic 軸 seed
│   │   ├── 02_master_topics_vocabulary.sql ← V軸 seed
│   │   └── 03_master_keywords_pilot.sql   ← Pilot セル KW seed
│   ├── migrations/
│   └── cannibalization.db                 ← 実DB (.gitignore対象)
│
├── src/
│   ├── ingestion/
│   │   ├── crawl.ts                       ← soico記事クロール
│   │   ├── extract.ts                     ← HTML→構造化データ
│   │   ├── gsc-pull.ts                    ← Phase 1 では認証確認のみ
│   │   ├── ga4-pull.ts                    ← 同上
│   │   ├── clarity-pull.ts                ← 同上
│   │   └── serpapi-pull.ts                ← 同上
│   ├── classification/
│   │   ├── kw-to-cell.ts                  ← KW→(subtopic, V軸) 推定
│   │   ├── title-to-cell.ts               ← 記事タイトル→セル割当
│   │   └── quarantine.ts                  ← 汚染判定
│   ├── lib/
│   │   ├── db.ts                          ← better-sqlite3 wrapper
│   │   ├── claude.ts                      ← Claude API wrapper
│   │   ├── openai.ts                      ← OpenAI API wrapper
│   │   ├── logger.ts
│   │   └── env.ts                         ← 環境変数 schema 検証
│   ├── api/
│   │   ├── server.ts                      ← Express起動
│   │   └── routes/
│   │       ├── articles.ts
│   │       ├── topics.ts
│   │       └── health.ts
│   ├── ui/                                ← Vite + React (Phase 1 では最小)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx
│   └── cli/
│       ├── seed.ts                        ← seeds/ 実行
│       ├── crawl-soico.ts                 ← クロール実行
│       └── classify-titles.ts             ← タイトル一括分類
│
├── scripts/
│   ├── verify-env.ts                      ← 全API認証ヘルスチェック
│   └── verify-db.ts                       ← DB整合性チェック
│
├── tests/
│   ├── unit/
│   └── integration/
│
└── .github/
    └── workflows/
        └── ci.yml                         ← lint + test
```

---

## 4. 環境セットアップ

### 4.1 リポジトリ初期化

```bash
# GitHub で空リポジトリ作成 (private)
# ローカル
mkdir -p ~/projects/cannibalization-system
cd ~/projects/cannibalization-system
git init
git remote add origin git@github.com:<daiki-account>/cannibalization-system.git

# Node プロジェクト初期化
npm init -y
# package.json は §4.4 の内容に置換

# TypeScript & 開発依存
npm install -D typescript @types/node tsx vitest biome
npm install -D @types/express @types/better-sqlite3

# 本番依存
npm install express better-sqlite3 dotenv pino
npm install playwright cheerio undici
npm install @anthropic-ai/sdk openai googleapis @google-analytics/data
npm install zod  # 環境変数schema検証
```

### 4.2 .env.example

```bash
# === Database ===
DB_PATH=./db/cannibalization.db

# === soico target ===
SOICO_BASE_URL=https://www.soico.jp
SOICO_CARDLOAN_PATH=/no1/news/cardloan
USER_AGENT_FOR_CRAWL=Mozilla/5.0 (compatible; CannibalizationSystem/1.0)

# === Xserver SSH (記事直接取得が必要な場合) ===
# ※基本はWebクロール、SSHは fallback
XSERVER_HOST=sv8169.xserver.jp
XSERVER_PORT=10022
XSERVER_USER=username@soico.jp
XSERVER_KEY_PATH=~/.ssh/xserver_soico

# === Google APIs ===
GOOGLE_APPLICATION_CREDENTIALS=./.secrets/gcp-service-account.json
GSC_PROPERTY_URL=https://www.soico.jp/
GA4_PROPERTY_ID=
CLARITY_PROJECT_ID=
CLARITY_API_TOKEN=

# === SerpAPI ===
SERPAPI_KEY=

# === LLM APIs ===
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# === Server ===
PORT=4000
LOG_LEVEL=info
NODE_ENV=development
```

### 4.3 .gitignore

```
node_modules/
dist/
.env
.secrets/
db/*.db
db/*.db-journal
db/*.db-wal
*.log
.DS_Store
coverage/
```

### 4.4 package.json (核となる scripts)

```json
{
  "name": "cannibalization-system",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/api/server.ts",
    "ui:dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "vitest",
    "db:create": "tsx src/cli/seed.ts --create",
    "db:seed": "tsx src/cli/seed.ts --seed-all",
    "db:reset": "tsx src/cli/seed.ts --reset",
    "crawl:soico": "tsx src/cli/crawl-soico.ts",
    "classify:titles": "tsx src/cli/classify-titles.ts",
    "verify:env": "tsx scripts/verify-env.ts",
    "verify:db": "tsx scripts/verify-db.ts"
  }
}
```

---

## 5. DB Schema (完全版)

`db/schema.sql` にそのまま転記する。

```sql
-- =====================================================
-- cannibalization-system DB Schema v0.1
-- =====================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------
-- Strategic Layer: Topics & Vocabulary
-- -----------------------------------------------------

-- subtopic 軸とその中分類、および V軸を統一管理
-- topic_kind で種別を分ける
CREATE TABLE IF NOT EXISTS master_topics (
  topic_id            TEXT PRIMARY KEY,           -- 'A1', 'A1.1', 'V5-1', 'D1' 等
  topic_kind          TEXT NOT NULL,              -- 'subtopic_major' / 'subtopic_minor' / 'vocabulary' / 'pillar'
  parent_topic_id     TEXT,                       -- 階層
  axis_letter         TEXT,                       -- 'A','B','C','D','E','F','G','V' (subtopic_*用)
  vocabulary_group    TEXT,                       -- 'lexical' / 'product_brand' / 'alternative' / 'public' / 'illegal_warning' (vocabulary用)
  name                TEXT NOT NULL,              -- 表示名
  description         TEXT,                       -- 補足
  conceptual_parent_id TEXT,                      -- 概念階層 (C > B 等のメタ情報)
  centroid_vector     BLOB,                       -- Phase 2 で生成
  centroid_updated_at INTEGER,                    -- unix timestamp
  created_at          INTEGER DEFAULT (strftime('%s','now')),
  updated_at          INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (parent_topic_id) REFERENCES master_topics(topic_id)
);

CREATE INDEX idx_master_topics_kind ON master_topics(topic_kind);
CREATE INDEX idx_master_topics_axis ON master_topics(axis_letter);
CREATE INDEX idx_master_topics_parent ON master_topics(parent_topic_id);

-- KW マスター
CREATE TABLE IF NOT EXISTS master_keywords (
  keyword_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword                 TEXT NOT NULL,
  canonical_keyword_id    INTEGER,                -- 同義語正規化先 (NULL なら自身が canonical)
  subtopic_topic_id       TEXT,                   -- 帰属 subtopic
  vocabulary_topic_id     TEXT,                   -- 帰属 V軸
  intent_layer            TEXT,                   -- '顕在' / '潜在' / '安心' (任意)
  tier                    INTEGER,                -- 1〜4 (KW生成ルールのLayer)
  search_volume           INTEGER,                -- Phase 2 以降に SerpAPI/GSC で更新
  status                  TEXT DEFAULT 'active',  -- 'active' / 'pending' / 'rejected'
  created_at              INTEGER DEFAULT (strftime('%s','now')),
  updated_at              INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE(keyword),
  FOREIGN KEY (canonical_keyword_id) REFERENCES master_keywords(keyword_id),
  FOREIGN KEY (subtopic_topic_id) REFERENCES master_topics(topic_id),
  FOREIGN KEY (vocabulary_topic_id) REFERENCES master_topics(topic_id)
);

CREATE INDEX idx_master_keywords_canonical ON master_keywords(canonical_keyword_id);
CREATE INDEX idx_master_keywords_subtopic ON master_keywords(subtopic_topic_id);
CREATE INDEX idx_master_keywords_vocabulary ON master_keywords(vocabulary_topic_id);

-- -----------------------------------------------------
-- Article inventory
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS master_articles (
  article_id              INTEGER PRIMARY KEY,    -- soicoの記事ID (URL末尾)
  url                     TEXT NOT NULL UNIQUE,
  title                   TEXT NOT NULL,
  body_hash               TEXT,                   -- 本文SHA256 (重複検出用)
  body_text               TEXT,                   -- 本文 (embedding用、重い場合は別テーブル化検討)
  word_count              INTEGER,
  publish_date            TEXT,                   -- YYYY-MM-DD
  last_modified           TEXT,                   -- YYYY-MM-DD
  status                  TEXT DEFAULT 'published', -- 'published' / 'noindex' / 'deleted' / 'redirected'
  redirect_target_url     TEXT,
  
  -- 二次元セル割当 (Phase 1 はタイトルベース仮割当、Phase 3 で確定)
  subtopic_axis           TEXT,                   -- 'A','B','C','D','E','F','G'
  subtopic_topic_id       TEXT,                   -- 中分類まで決まる場合
  vocabulary_topic_id     TEXT,                   -- V軸
  classification_method   TEXT,                   -- 'title_based' / 'embedding_based' / 'human_confirmed'
  classification_confidence REAL,                 -- 0.0〜1.0
  
  -- カテゴリ汚染管理
  category_quarantine     TEXT DEFAULT 'in_scope',-- 'in_scope' / 'pending' / 'confirmed'
  quarantine_reason       TEXT,
  
  -- Embedding (Phase 2 で生成)
  article_embedding       BLOB,
  embedding_model         TEXT,                   -- 'text-embedding-3-large' 等
  embedding_updated_at    INTEGER,
  
  -- メタ
  crawled_at              INTEGER,                -- 最終クロール時刻
  created_at              INTEGER DEFAULT (strftime('%s','now')),
  updated_at              INTEGER DEFAULT (strftime('%s','now')),
  
  FOREIGN KEY (subtopic_topic_id) REFERENCES master_topics(topic_id),
  FOREIGN KEY (vocabulary_topic_id) REFERENCES master_topics(topic_id)
);

CREATE INDEX idx_articles_subtopic ON master_articles(subtopic_axis, subtopic_topic_id);
CREATE INDEX idx_articles_vocabulary ON master_articles(vocabulary_topic_id);
CREATE INDEX idx_articles_quarantine ON master_articles(category_quarantine);
CREATE INDEX idx_articles_status ON master_articles(status);

-- 記事 ↔ KW の対応 (任意の多対多)
CREATE TABLE IF NOT EXISTS article_keywords (
  article_id              INTEGER NOT NULL,
  keyword_id              INTEGER NOT NULL,
  source                  TEXT,                   -- 'gsc' / 'manual' / 'inferred_from_title'
  PRIMARY KEY (article_id, keyword_id),
  FOREIGN KEY (article_id) REFERENCES master_articles(article_id) ON DELETE CASCADE,
  FOREIGN KEY (keyword_id) REFERENCES master_keywords(keyword_id) ON DELETE CASCADE
);

-- -----------------------------------------------------
-- Performance snapshots (Phase 2 以降に投入)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS article_performance_snapshots (
  snapshot_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id              INTEGER NOT NULL,
  snapshot_date           TEXT NOT NULL,          -- YYYY-MM-DD
  window_days             INTEGER NOT NULL,       -- 90 / 180 等
  
  -- GSC
  clicks                  INTEGER,
  impressions             INTEGER,
  ctr                     REAL,
  avg_position            REAL,
  
  -- GA4
  sessions                INTEGER,
  engaged_sessions        INTEGER,
  cv_count                INTEGER,
  cv_rate                 REAL,
  
  -- Clarity
  dead_clicks             INTEGER,
  rage_clicks             INTEGER,
  scroll_depth_avg        REAL,
  
  created_at              INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (article_id) REFERENCES master_articles(article_id) ON DELETE CASCADE,
  UNIQUE(article_id, snapshot_date, window_days)
);

CREATE INDEX idx_perf_article ON article_performance_snapshots(article_id);
CREATE INDEX idx_perf_date ON article_performance_snapshots(snapshot_date);

-- 個別クエリ × 記事の GSC スナップショット (カニバリ判定の中核データ)
CREATE TABLE IF NOT EXISTS gsc_query_url_snapshots (
  snapshot_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id              INTEGER NOT NULL,
  query                   TEXT NOT NULL,
  snapshot_date           TEXT NOT NULL,
  window_days             INTEGER NOT NULL,
  clicks                  INTEGER,
  impressions             INTEGER,
  ctr                     REAL,
  avg_position            REAL,
  created_at              INTEGER DEFAULT (strftime('%s','now')),
  FOREIGN KEY (article_id) REFERENCES master_articles(article_id) ON DELETE CASCADE
);

CREATE INDEX idx_gsc_qu_article ON gsc_query_url_snapshots(article_id);
CREATE INDEX idx_gsc_qu_query ON gsc_query_url_snapshots(query);
CREATE INDEX idx_gsc_qu_date ON gsc_query_url_snapshots(snapshot_date);

-- -----------------------------------------------------
-- Cannibalization detection (Phase 2 以降に投入)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS cannibalization_pairs (
  pair_id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  article_a_id            INTEGER NOT NULL,
  article_b_id            INTEGER NOT NULL,
  cosine_similarity       REAL,
  serp_overlap_pct        REAL,
  shared_queries_count    INTEGER,
  shared_queries_json     TEXT,                   -- JSON: [{query, a_pos, b_pos, a_imp, b_imp}, ...]
  severity                TEXT,                   -- 'high' / 'medium' / 'low'
  detected_at             INTEGER DEFAULT (strftime('%s','now')),
  CHECK (article_a_id < article_b_id),            -- 重複防止
  UNIQUE(article_a_id, article_b_id),
  FOREIGN KEY (article_a_id) REFERENCES master_articles(article_id),
  FOREIGN KEY (article_b_id) REFERENCES master_articles(article_id)
);

-- -----------------------------------------------------
-- Decision log (Phase 3 以降に投入)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS decision_log (
  decision_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id              INTEGER,                -- 単独記事への判定
  pair_id                 INTEGER,                -- ペアへの判定
  action                  TEXT NOT NULL,          -- 'KEEP' / 'CONSOLIDATE' / 'DIFFERENTIATE' / 'SPLIT' / 'CANONICAL' / 'NOINDEX' / 'REASSIGN' / 'DELETE'
  target_url              TEXT,                   -- consolidate/canonical/redirect 先
  target_subtopic_id      TEXT,                   -- REASSIGN 時の移動先
  target_vocabulary_id    TEXT,                   -- 同上
  confidence_score        REAL,
  human_reviewed          INTEGER DEFAULT 0,      -- 0/1
  human_decision          TEXT,                   -- 人間が承認/修正した最終判定
  rationale_json          TEXT,                   -- JSON: {factors, scores, ...}
  decided_at              INTEGER DEFAULT (strftime('%s','now')),
  reviewed_at             INTEGER,
  executed_at             INTEGER,
  FOREIGN KEY (article_id) REFERENCES master_articles(article_id),
  FOREIGN KEY (pair_id) REFERENCES cannibalization_pairs(pair_id)
);

-- -----------------------------------------------------
-- Audit log (s-tools 同型)
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS master_audit_log (
  log_id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type             TEXT NOT NULL,          -- 'master_articles' / 'master_topics' / 'decision_log' 等
  entity_id               TEXT NOT NULL,
  action                  TEXT NOT NULL,          -- 'create' / 'update' / 'delete' / 'execute'
  before_state_json       TEXT,
  after_state_json        TEXT,
  actor                   TEXT NOT NULL,          -- 'claude_code' / 'human:daiki' / 'api' / 'cron'
  reason                  TEXT,
  created_at              INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX idx_audit_entity ON master_audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON master_audit_log(actor);
CREATE INDEX idx_audit_created ON master_audit_log(created_at);

-- -----------------------------------------------------
-- Migration 履歴
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
  version                 TEXT PRIMARY KEY,
  applied_at              INTEGER DEFAULT (strftime('%s','now'))
);

INSERT INTO schema_migrations (version) VALUES ('0.1.0');
```

---

## 6. Seeds

### 6.1 master_topics (subtopic 軸の中分類まで)

`db/seeds/01_master_topics.sql` に下記パターンで全件記述する。

```sql
-- 例: A軸 (属性別借入)
INSERT INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('A',  'subtopic_major', 'A', '属性別借入', '主語=人。self-identification 軸');

INSERT INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('A1', 'subtopic_minor', 'A', 'A', '雇用形態'),
  ('A2', 'subtopic_minor', 'A', 'A', '信用情報状態'),
  ('A3', 'subtopic_minor', 'A', 'A', '家族・婚姻'),
  ('A4', 'subtopic_minor', 'A', 'A', '職種特殊'),
  ('A5', 'subtopic_minor', 'A', 'A', '国籍・在留資格'),
  ('A6', 'subtopic_minor', 'A', 'A', '年齢・ライフステージ'),
  ('A7', 'subtopic_minor', 'A', 'A', '収入状態');

-- B軸〜G軸も同パターン (cardloan_topic_map.md §3 を参照して全件記述)
```

D軸は `topic_kind = 'pillar'` で記述:

```sql
INSERT INTO master_topics (topic_id, topic_kind, axis_letter, name, description) VALUES
  ('D', 'pillar', 'D', '比較・ランキング', 'subtopic配列の頂点・CV出口');

INSERT INTO master_topics (topic_id, topic_kind, parent_topic_id, axis_letter, name) VALUES
  ('D1', 'subtopic_minor', 'D', 'D', '商品比較ランキング'),
  ('D2', 'subtopic_minor', 'D', 'D', '軸別ランキング'),
  ('D3', 'subtopic_minor', 'D', 'D', '業態比較'),
  ('D4', 'subtopic_minor', 'D', 'D', '個社対決比較'),
  ('D5', 'subtopic_minor', 'D', 'D', '第三者評価'),
  ('D6', 'subtopic_minor', 'D', 'D', '困窮時総合ハブ'),
  ('D7', 'subtopic_minor', 'D', 'D', 'リテラシー・実態');
```

**概念階層** は `conceptual_parent_id` で表現:

```sql
-- 概念階層: C (目的) > B (条件)
UPDATE master_topics SET conceptual_parent_id = 'C' WHERE topic_id = 'B';
```

### 6.2 master_topics (V軸)

`db/seeds/02_master_topics_vocabulary.sql`

```sql
-- V軸トップ
INSERT INTO master_topics (topic_id, topic_kind, vocabulary_group, name) VALUES
  ('V',     'vocabulary', 'meta',                'V軸 (商品/サービス軸)');

-- V1〜V4: 語彙バリエーション
INSERT INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V1',    'vocabulary', 'V', 'lexical',         'カードローン (主軸)'),
  ('V2',    'vocabulary', 'V', 'lexical',         'キャッシング'),
  ('V3',    'vocabulary', 'V', 'lexical',         '消費者金融'),
  ('V4',    'vocabulary', 'V', 'lexical',         'お金借りる/借入');

-- V5: 大手消費者金融
INSERT INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V5',    'vocabulary', 'V',  'product_brand', '大手消費者金融'),
  ('V5-1',  'vocabulary', 'V5', 'product_brand', 'アイフル'),
  ('V5-2',  'vocabulary', 'V5', 'product_brand', 'プロミス'),
  ('V5-3',  'vocabulary', 'V5', 'product_brand', 'アコム'),
  ('V5-4',  'vocabulary', 'V5', 'product_brand', 'SMBCモビット'),
  ('V5-5',  'vocabulary', 'V5', 'product_brand', 'レイク');

-- V6 メガ・ネット銀行 / V7 地方銀行 / V8 中小消費者金融 / V9 スマホ・新興 /
-- V10 クレカ商標 / V11 担保系 / V12 後払い・先払い / V13 学生ローン /
-- V14 公的制度 / V15 個人間借入 / V16 違法警告
-- は cardloan_topic_map.md §4 を参照して全件記述
```

### 6.3 master_keywords (Pilot セル D1×V1)

`db/seeds/03_master_keywords_pilot.sql`

`keyword_portfolios.md` §6.2 の Tier 1〜3 を 22 KW として登録:

```sql
INSERT INTO master_keywords (keyword, subtopic_topic_id, vocabulary_topic_id, tier, intent_layer)
VALUES
  -- Tier 1
  ('カードローン おすすめ',      'D1', 'V1', 1, '顕在'),
  ('カードローン 比較',          'D1', 'V1', 1, '顕在'),
  ('カードローン ランキング',    'D1', 'V1', 1, '顕在'),
  ('カードローン 人気',          'D1', 'V1', 1, '顕在'),
  ('カードローン どこがいい',    'D1', 'V1', 1, '顕在'),
  ('カードローン どれがいい',    'D1', 'V1', 1, '顕在'),
  ('カードローン 選び方',        'D1', 'V1', 1, '顕在'),
  -- Tier 2 (8 KW)
  -- Tier 3 (7 KW)
  -- ※ keyword_portfolios.md §6.2 から全22件転記
;
```

---

## 7. データ取り込み層の実装方針

### 7.1 soico クロール戦略

`src/cli/crawl-soico.ts`

#### 7.1.1 記事一覧の取得方法 (3段階フォールバック)

```
方式A: sitemap.xml から取得
  → /sitemap.xml or /no1/sitemap.xml を fetch
  → /no1/news/cardloan/ で始まる URL を抽出
  → 失敗したら方式B

方式B: カテゴリページのページネーション
  → /no1/news/cardloan/ をクロール
  → ページネーションをたどり全URLを収集
  → 失敗したら方式C

方式C: Daiki から渡される手動リスト
  → docs/strategic/article_inventory_initial.csv
  → 434件の (id, url, title) リスト
  → 本ドキュメント作成時点でDaikiから渡される予定
  → ユーザーが提示済みの434件リストを csv にして seed 済みとする
```

**推奨**: Phase 1 は方式C (Daiki提供の434件リスト) を seed として使用し、URL リストは確定とする。方式 A/B は Phase 2 以降の差分検出で使う。

#### 7.1.2 各記事の本文取得

```typescript
// src/ingestion/crawl.ts (擬似コード)
import { chromium } from 'playwright';
import { load } from 'cheerio';

async function crawlArticle(url: string, articleId: number) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: process.env.USER_AGENT_FOR_CRAWL,
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const html = await page.content();
    const $ = load(html);
    
    const title = $('h1').first().text().trim() || $('title').text().trim();
    const bodyText = $('article, .entry-content, main').first().text().trim();
    const publishDate = extractDate($, 'meta[property="article:published_time"]');
    const lastModified = extractDate($, 'meta[property="article:modified_time"]');
    
    return {
      article_id: articleId,
      url,
      title,
      body_text: bodyText,
      body_hash: sha256(bodyText),
      word_count: bodyText.length,
      publish_date: publishDate,
      last_modified: lastModified,
      status: 'published',
      crawled_at: Math.floor(Date.now() / 1000),
    };
  } finally {
    await browser.close();
  }
}
```

#### 7.1.3 Cloudflare WAF 対策

ナレッジ既出の事実: soico 系は Cloudflare WAF で外部クラウド IP がブロックされる場合がある。

**対策の優先順**:
1. ローカル開発機 (Daiki の Mac) からクロールする — 通常の住宅 IP なら通過する
2. `--user-agent=Mozilla/5.0 ...` を設定 (実ブラウザ風)
3. Playwright で実ブラウザを使う (cheerio fetch だけでは弾かれる場合がある)
4. それでも弾かれる時は SSH で Xserver にアクセスして WordPress DB から直接記事取得 (.env の XSERVER_* を使用)
5. 並列度は最大 3、リクエスト間隔 2秒以上

**起動チェックリスト**:
- [ ] 実機からクロール可能か疎通テスト (`curl -I -A "..." https://www.soico.jp/no1/news/cardloan/11077`)
- [ ] Playwright で1記事だけ取得成功
- [ ] WAFブロックされたら SSH fallback に切り替え

### 7.2 タイトルベース分類

`src/classification/title-to-cell.ts`

#### 入力: 記事タイトル
#### 出力: (subtopic_topic_id, vocabulary_topic_id, confidence)

```typescript
// 擬似コード
const VOCABULARY_PATTERNS: Array<[string, string]> = [
  ['アイフル', 'V5-1'],
  ['プロミス', 'V5-2'],
  ['アコム',   'V5-3'],
  // ...
  ['カードローン', 'V1'],
  ['キャッシング', 'V2'],
  ['消費者金融',   'V3'],
  ['お金借りる',   'V4'],
];

const SUBTOPIC_PATTERNS: Array<[RegExp, string]> = [
  [/おすすめ|比較|ランキング|どこがいい|どれがいい|選び方/, 'D1'],
  [/とは|仕組み|違い/, 'E1'],
  [/メリット.*デメリット|デメリット|リスク/, 'E4'],
  [/方法|流れ|手順|借り方/, 'F1'],
  [/在籍確認/, 'B2'],   // 「在籍確認なし」「在籍確認 電話なし」等
  [/即日/, 'B1'],
  [/低金利|金利/, 'B3'],
  [/無利息/, 'B3'],
  [/(\d+)円?借りる|(\d+)万/, 'B4'],
  [/郵送物なし|電話なし|バレない|知られない/, 'B8'],
  [/主婦/, 'A3'],
  [/学生|大学生|未成年|18歳|19歳/, 'A6'],
  [/無職/, 'A1'],
  [/個人事業主|自営業|フリーランス/, 'A1'],
  [/外国人/, 'A5'],
  [/高齢者|年金|80歳|70歳/, 'A6'],
  [/水商売|風俗/, 'A4'],
  [/公務員|自衛官/, 'A4'],
  [/ブラック|債務整理|自己破産|個人再生/, 'A2'],
  [/フリーター|アルバイト|派遣/, 'A1'],
  [/おまとめ/, 'C6'],
  [/借り換え/, 'C6'],
  [/教育ローン|学費/, 'C4'],
  [/医療費/, 'C2'],
  [/事業資金|ビジネスローン/, 'C9'],
  [/払えない|滞納|延滞/, 'G1'],
  [/督促|差し押さえ/, 'G2'],
  [/債務整理|自己破産|任意整理/, 'G3'],
  [/闇金|ソフト闇金|個人間融資|アリバイ/, 'G4'],
  [/過払い金/, 'G5'],
  [/総量規制|貸金業法|利息制限法/, 'E5'],
  [/解約/, 'F7'],
  [/増額|限度額/, 'F6'],
  [/返済/, 'F5'],
  [/審査落ち|審査基準|審査/, 'F3'],
  // 商標が出る記事は (商標 V) × (B2 在籍確認 or F5 返済 等) のように上記の subtopic 検出が機能する
];

function classifyTitle(title: string): { subtopic_topic_id: string | null; vocabulary_topic_id: string | null; confidence: number } {
  const v = VOCABULARY_PATTERNS.find(([p]) => title.includes(p))?.[1] ?? null;
  const s = SUBTOPIC_PATTERNS.find(([re]) => re.test(title))?.[1] ?? null;
  const confidence = (v && s) ? 0.7 : 0.3;
  return { subtopic_topic_id: s, vocabulary_topic_id: v, confidence };
}
```

**注意**: タイトルベース分類は暫定 (confidence 0.3〜0.7)。Phase 3 で embedding ベースの分類に置き換わる。Phase 1 ではこの暫定分類で全記事を埋め、Daikiが UI で確認できるようにする。

### 7.3 汚染フラグの初期セット

`src/classification/quarantine.ts`

```typescript
const QUARANTINE_CONFIRMED = [
  { article_id: 13904, reason: 'DeFi/仮想通貨カテゴリ' },
  { article_id: 18818, reason: '住宅ローン専門 (5000万円変動金利)' },
  { article_id: 19347, reason: '住宅ローン専門 (公務員)' },
  { article_id: 14130, reason: '住宅ローンの在籍確認' },
  { article_id: 14148, reason: '賃貸契約の在籍確認' },
];

const QUARANTINE_PENDING = [
  { article_id: 17549, reason: '変動金利の文脈要確認 (cardloan or 住宅ローン)' },
  { article_id: 14056, reason: 'クレカの在籍確認 — キャッシング機能なら範囲内' },
  { article_id: 14077, reason: '同上' },
  { article_id: 22431, reason: '同上' },
  { article_id: 22539, reason: 'JCBカードW — キャッシング枠の話なら範囲内' },
];

// 範囲拡張で範囲内 (旧汚染リストから外したもの)
// article_id 16729 (役員貸付金) は category_quarantine = 'in_scope' のまま (デフォルト)
```

これを seed として全記事登録時に適用する。

### 7.4 GSC / GA4 / Clarity / SerpAPI 認証 (Phase 1 では確認のみ)

#### GSC
- Google Cloud Console でサービスアカウント作成
- Search Console > 設定 > ユーザーと権限 でサービスアカウントを追加 (制限付き権限)
- `googleapis` SDK で `searchconsole.searchanalytics.query` を1回だけ叩く
- `scripts/verify-env.ts` で疎通確認

#### GA4
- 同様のサービスアカウントに GA4 プロパティの閲覧者権限付与
- `@google-analytics/data` で properties.runReport を1回叩く

#### Clarity
- Clarity > Settings > Data Export API でトークン取得
- Project ID と組み合わせて1回叩く

#### SerpAPI
- API キーで Google JP 検索を1回叩く

#### Claude API / OpenAI API
- それぞれ最小トークンで1回叩く

すべて `npm run verify:env` で一括チェックできるようにする:

```typescript
// scripts/verify-env.ts (擬似コード)
async function main() {
  const checks = [
    { name: 'GSC',     fn: checkGSC },
    { name: 'GA4',     fn: checkGA4 },
    { name: 'Clarity', fn: checkClarity },
    { name: 'SerpAPI', fn: checkSerpAPI },
    { name: 'Claude',  fn: checkClaude },
    { name: 'OpenAI',  fn: checkOpenAI },
  ];
  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (e) {
      console.error(`❌ ${name}:`, e.message);
    }
  }
}
```

---

## 8. 実装順序の推奨

```
Day 1-2:
  1. リポジトリ作成 + tsconfig + biome 設定
  2. .env.example + 環境変数 schema (zod)
  3. db/schema.sql 作成 + db:create コマンド動作確認
  4. lib/db.ts (better-sqlite3 wrapper)

Day 3-4:
  5. seeds/ 全件記述 (subtopic + V軸 + Pilot KW)
  6. db:seed コマンド動作確認
  7. classification/title-to-cell.ts のロジック + テスト

Day 5-7:
  8. ingestion/crawl.ts (Playwright + cheerio)
  9. cli/crawl-soico.ts で1記事だけ取得成功
  10. WAF 疎通確認
  11. 全434記事クロール実行 → master_articles 登録
  12. 汚染フラグの一括適用

Day 8-9:
  13. classify-titles.ts で全記事のセル割当
  14. UI 最小実装 (記事一覧表示)

Day 10-12:
  15. verify-env.ts で全API認証確認
  16. integration test (DB 整合性、件数等)

Day 13-14:
  17. phase2_semantic_handoff.md ドラフト作成
  18. Daiki レビュー → 修正 → Phase 1 完了
```

---

## 9. 完成検証 (DoDチェック手順)

```bash
# 1. リポジトリ
test -d ~/projects/cannibalization-system && echo "✅ repo exists"

# 2. dev起動
npm run dev   # → "Server listening on port 4000"

# 3. DB
sqlite3 db/cannibalization.db ".tables"
# → master_topics, master_keywords, master_articles 等が表示される

# 4. Strategic Layer
ls docs/strategic/
# → business_relevance.md, cardloan_topic_map.md, keyword_portfolios.md

# 5. Topics seed
sqlite3 db/cannibalization.db \
  "SELECT topic_kind, COUNT(*) FROM master_topics GROUP BY topic_kind;"
# → subtopic_major: 7 / subtopic_minor: 約50 / pillar: 1 / vocabulary: 約60

# 6. KW seed
sqlite3 db/cannibalization.db \
  "SELECT COUNT(*) FROM master_keywords WHERE subtopic_topic_id='D1' AND vocabulary_topic_id='V1';"
# → 22

# 7. Articles
sqlite3 db/cannibalization.db "SELECT COUNT(*) FROM master_articles;"
# → 434

# 8. 確定汚染
sqlite3 db/cannibalization.db \
  "SELECT COUNT(*) FROM master_articles WHERE category_quarantine='confirmed';"
# → 5

# 9. 要判定
sqlite3 db/cannibalization.db \
  "SELECT COUNT(*) FROM master_articles WHERE category_quarantine='pending';"
# → 5

# 10. 暫定セル割当
sqlite3 db/cannibalization.db \
  "SELECT COUNT(*) FROM master_articles WHERE subtopic_topic_id IS NOT NULL;"
# → 380以上 (タイトルから取れない記事は手動補完候補)

# 11. クロール完了
sqlite3 db/cannibalization.db \
  "SELECT COUNT(*) FROM master_articles WHERE crawled_at IS NOT NULL AND body_text IS NOT NULL;"
# → 434 (確定汚染を含む。Phase 2 でフィルタ)

# 12. 認証確認
npm run verify:env
# → 全て ✅

# 13. Phase 2 handoff
test -f docs/handoffs/phase2_semantic_handoff.md && echo "✅ phase2 handoff drafted"
```

---

## 10. リスクと注意点

### 10.1 構造汚染による誤判定の連鎖
タイトルベース分類は誤判定する。例:
- 14130 「住宅ローンの在籍確認」 → タイトルに「在籍確認」があるため B2 に分類されるが、本来は範囲外 (汚染確定)
- → **汚染フラグを優先**: `category_quarantine = 'confirmed'` の記事は subtopic 分類しない or 「quarantine_*」プレフィックス付きの値にする

### 10.2 Cloudflare WAF
- Phase 1 で WAF にブロックされた場合、進行を止めず Daiki に SSH fallback の実行を依頼
- ブロックされた記事は別途 master_articles に空レコードを入れ、Phase 2 で手動補完

### 10.3 GSC データの遅延
- GSC の最新データは 2-3 日遅れ。Phase 1 では認証のみ確認、データ pull は Phase 2 で
- GSC API の過去データ制限: 16 ヶ月。バックフィルは早期に実行する設計余地

### 10.4 Embedding コスト見積
- 434記事 × 平均5000字 ≈ 2.2M tokens
- text-embedding-3-large = $0.13 / 1M tokens
- 初回 embedding コスト ≈ $0.30 (低い。コスト懸念なし)
- ただし topic centroid + 派生計算で再 embedding する場面もある

### 10.5 「2026年」表記の自動化伏線
- 各記事タイトル末尾に「【2026年】」が大量にある
- Phase 1 ではこの表記を保持。Phase 4 (Pilot) で更新自動化を検討
- 自走リライトシステムとの統合点として記録

### 10.6 SQLite の選択理由と限界
- 単一マシン運用前提 (Daiki のローカル + サーバ1台)
- 同時書き込みは Phase 5 までは想定しない
- もし将来並列処理が必要になったら PostgreSQL 移行を検討

---

## 11. Phase 2 への引き継ぎ事項

Phase 1 完了時に Claude Code が以下を `docs/handoffs/phase2_semantic_handoff.md` にドラフトする。

### Phase 2 (Semantic) の主タスク
1. text-embedding-3-large で全記事 embedding 生成 → master_articles.article_embedding
2. 各 subtopic + V軸 ノードの topic centroid 計算 → master_topics.centroid_vector
3. business_relevance.md を embedding → 別テーブルに保存 (相似度計算の基準)
4. 全記事ペアの cosine similarity 行列計算
5. cannibalization_pairs テーブルへの抽出 (cosine ≥ 0.85 のペア)
6. SerpAPI で抽出ペアの SERP overlap_pct 計算 (上位ペアのみ、コスト管理)
7. GSC API でクエリ × URL の実データ pull → gsc_query_url_snapshots
8. 要判定5件の本文 embedding 化による自動分類確定 (category_quarantine 'pending' → 'in_scope' or 'confirmed')

### Phase 2 完成定義
- 全記事に embedding が付与されている
- 全 subtopic / V軸 セルに centroid がある
- cannibalization_pairs に抽出済み (件数想定: 数百〜千)
- 要判定5件の汚染分類が確定済み
- gsc_query_url_snapshots に直近 6ヶ月分が入っている

---

## 12. このドキュメントへの修正・問い合わせ

- 不明点は Daiki に確認 (Web Chat の Claude 経由で構造判断を仰ぐ)
- 実装上の判断は Claude Code 側で完結させてよいが、Strategic Layer の解釈に関わる判断 (subtopic の追加・V軸の追加・汚染リストの修正) は必ず Daiki の承認を経る
- `master_audit_log` に全変更を記録すること

---

## 13. バージョン管理

| 日付 | 変更内容 | 承認者 |
|------|---------|-------|
| 2026-05-02 | 初版作成 (Phase 0 完了直後) | Daiki |
