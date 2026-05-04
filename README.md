# cannibalization-system

soico の cardloan/ カテゴリにおけるキーワードカニバリゼーション解消システム。

## Phase 1 (Foundation)

データ取り込み基盤と全記事のインベントリ化。詳細は [docs/handoffs/phase1_foundation_handoff.md](docs/handoffs/phase1_foundation_handoff.md) を参照。

## Strategic Layer

全判定の真理は `docs/strategic/` の3ファイル:

- [business_relevance.md](docs/strategic/business_relevance.md) — 北極星ステートメント
- [cardloan_topic_map.md](docs/strategic/cardloan_topic_map.md) — subtopic と V軸の構造
- [keyword_portfolios.md](docs/strategic/keyword_portfolios.md) — KW 生成ルール

## セットアップ

```bash
cp .env.example .env
# .env を編集してAPIキー等を設定

npm install
npx playwright install chromium

npm run db:create   # スキーマ作成
npm run db:seed     # マスター seed
npm run crawl:soico # 434記事クロール
npm run classify:titles # タイトル分類
npm run verify:env  # 全API認証確認
npm run verify:db   # DB整合性確認
```

## 開発

```bash
npm run dev      # API サーバ
npm run ui:dev   # Vite UI (別ターミナル)
npm run test     # vitest
npm run lint     # biome
```
