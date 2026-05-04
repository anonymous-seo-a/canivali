# Runbook: soico crawl

## 用途
soico cardloan/ カテゴリ 434 記事の本文 + メタデータ取得。

## 前提
- `npm install` 済み
- `npx playwright install chromium` 済み
- `.env` で `USER_AGENT_FOR_CRAWL`, `CRAWL_DELAY_MS`, `CRAWL_CONCURRENCY` 設定済み
- `docs/strategic/article_inventory_initial.csv` がリポジトリに存在

## 通常実行

```bash
# 1) DB 初期化
npm run db:reset
npm run db:seed

# 2) CSV から master_articles に upsert (本文取得なし)
npm run crawl:soico -- --upsert-only

# 3) 1記事だけ smoke test
npm run crawl:soico -- --id=11077

# 4) 全件クロール (約 15 分)
npm run crawl:soico

# 5) タイトル分類
npm run classify:titles

# 6) 検証
npm run verify:db
```

## CLI フラグ

| フラグ | 用途 |
|--------|------|
| `--id=<n>` | 単発クロール (smoke test) |
| `--limit=<n>` | 先頭 N 件のみ |
| `--upsert-only` | CSV 反映のみ、本文取得スキップ |
| `--skip-quarantined` | `category_quarantine='confirmed'` をクロール対象外 |

## トラブルシューティング

### Cloudflare WAF でブロックされる
ログに `non-ok response 403` が連続する場合:

1. **ローカル機 (住宅 IP) から実行する** — クラウド IP は弾かれやすい
2. UA を実ブラウザのものに差し替え (`.env` の `USER_AGENT_FOR_CRAWL`)
3. `CRAWL_DELAY_MS` を 5000 などに引き上げる
4. それでも弾かれる場合は **Xserver SSH fallback** に切り替え (別途実装、本ランブックの範囲外)

### 一部記事だけ本文が空
`master_articles.body_text IS NULL` のものをリストアップし、再クロール:

```bash
sqlite3 db/cannibalization.db \
  "SELECT article_id FROM master_articles WHERE body_text IS NULL ORDER BY article_id" |
  xargs -I{} npm run crawl:soico -- --id={}
```

### 404 になった記事
`status='deleted'` がマークされる。Phase 2 では除外して embedding。

## メモ
- リクエスト間隔は `CRAWL_DELAY_MS` (デフォ 2000ms)
- 並列度は本実装では未使用 (sequential)。将来 `CRAWL_CONCURRENCY` を活かす場合は p-queue 等で
- 全文 SHA256 を `body_hash` に格納 → Phase 2 以降の差分検出に使う
