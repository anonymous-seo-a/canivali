# Runbook: 外部 API 認証セットアップ

`npm run verify:env` で全外部APIの疎通確認ができる。各APIの初期セットアップ手順を以下にまとめる。

## Google Search Console (GSC)

### 1. サービスアカウント作成
1. Google Cloud Console > IAM > サービスアカウント
2. 新規作成 (例: `cannibalization-system-gsc`)
3. キーを JSON でダウンロード → `.secrets/gcp-service-account.json` に置く
4. `.env`:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./.secrets/gcp-service-account.json
   GSC_PROPERTY_URL=https://www.soico.jp/
   ```

### 2. GSC で権限付与
1. Search Console > 設定 > ユーザーと権限
2. サービスアカウントの email (`xxx@xxx.iam.gserviceaccount.com`) を「制限付き」で追加

### 3. 確認
```bash
npm run verify:env
# → ✅ GSC — auth ok
```

## GA4

### 1. 同じサービスアカウントに GA4 閲覧者権限付与
1. GA4 管理 > プロパティ > アクセス管理
2. サービスアカウントを「閲覧者」で追加

### 2. プロパティ ID を `.env` に
```
GA4_PROPERTY_ID=123456789
```

## Microsoft Clarity

### 1. トークン発行
1. Clarity ダッシュボード > Settings > Data Export API
2. API token を発行 → `.env`:
   ```
   CLARITY_API_TOKEN=...
   CLARITY_PROJECT_ID=...
   ```

### 2. 注意
Clarity API は無料枠でレート制限あり。Phase 2 で本実装する際に確認すること。

## SerpAPI

```
SERPAPI_KEY=...
```

## Anthropic / OpenAI

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## 一括検証

```bash
npm run verify:env
```

すべて `✅` または `⏭️` (env 未設定 = 後で設定する) であれば OK。`❌` が出た場合は該当 API のドキュメントを参照。
