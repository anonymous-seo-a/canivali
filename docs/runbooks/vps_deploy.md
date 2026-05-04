# Runbook: VPS デプロイ (cannibalization-system)

s-tools と同じ VPS / 同じパターンで運用する。

## 前提
- s-tools が既に動いている VPS (rewrite.anonymous-seo.jp が稼働中)
- pm2 名は `cannibalization-app` (rewrite-app と被らない)
- ポートは **4040** (rewrite は 3001 を使用)
- ドメイン: `canivali.anonymous-seo.jp` (s-tools の `<app>.anonymous-seo.jp` パターンに準拠)

---

## 初回セットアップ (VPS 側)

### 1. リポジトリを clone
```bash
ssh root@<VPS_HOST>
cd /opt
GIT_SSH_COMMAND="ssh -i /root/.ssh/github_deploy" \
  git clone git@github.com:anonymous-seo-a/canivali.git cannibalization-system
cd cannibalization-system
npm ci --no-audit --no-fund
```

GitHub deploy key (`/root/.ssh/github_deploy`) は s-tools 用と同じものを再利用可。anonymous-seo-a/canivali リポジトリにも同 deploy key を「Read access」で追加する必要あり (リポジトリ Settings → Deploy keys)。

### 2. 本番 .env を配置
ローカルから:
```bash
scp .env.production root@<VPS_HOST>:/opt/cannibalization-system/.env
```

`.env.production` は `.env.example` をコピーして本番用キーを埋めたもの。`PORT=4040` を必ず指定。

### 3. SQLite DB と embedding 等を用意 (初回のみ)
ローカルで `db/cannibalization.db` を作って scp、もしくは VPS 上で `npm run db:seed && npm run crawl:soico && ...` を回す。後者は数時間かかるので scp 推奨。

```bash
scp db/cannibalization.db root@<VPS_HOST>:/opt/cannibalization-system/db/
```

### 4. Vite ビルド
```bash
ssh root@<VPS_HOST>
cd /opt/cannibalization-system
npm run build      # → dist/ui/index.html を生成
```

### 5. pm2 で起動
```bash
pm2 start npm --name cannibalization-app -- run start:prod
pm2 save
pm2 logs cannibalization-app   # 確認
```

### 6. nginx 設定

`/etc/nginx/sites-available/cannibalization`:
```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name canivali.anonymous-seo.jp;

    ssl_certificate     /etc/letsencrypt/live/canivali.anonymous-seo.jp/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/canivali.anonymous-seo.jp/privkey.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:4040;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name canivali.anonymous-seo.jp;
    return 301 https://$host$request_uri;
}
```

```bash
ln -s /etc/nginx/sites-available/cannibalization /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 7. HTTPS (Let's Encrypt)
事前に Cloudflare で `canivali.anonymous-seo.jp` の A レコードを VPS の IP に向ける。
```bash
certbot --nginx -d canivali.anonymous-seo.jp
```

### 8. Basic 認証 (社内用)
Phase 3 段階では誰でも実行ボタンを押せる状態は危険なので、basic 認証で保護:

```bash
htpasswd -c /etc/nginx/.htpasswd canivali
# パスワード入力
```

nginx の `location /` に追加:
```nginx
auth_basic "cannibalization-system";
auth_basic_user_file /etc/nginx/.htpasswd;
```

---

## 自動デプロイ (GitHub Actions)

`.github/workflows/deploy.yml` がリポジトリに含まれている。`main` push で自動デプロイ。

### 必要な GitHub Secrets

リポジトリ Settings → Secrets and variables → Actions:
| Secret | 値 |
|---|---|
| `VPS_HOST` | s-tools と同じ (再利用可) |
| `VPS_SSH_PRIVATE_KEY` | s-tools と同じ (再利用可) |

リポジトリ Settings → Deploy keys に GitHub deploy key の **public** 部分を「Read」権限で追加。

---

## 本番運用コマンド

```bash
ssh root@<VPS_HOST>

# プロセス確認
pm2 status

# ログ
pm2 logs cannibalization-app --lines 100

# 再起動 (env 変更後)
pm2 restart cannibalization-app --update-env

# DB の場所
ls -la /opt/cannibalization-system/db/

# 月次更新 (GSC + SerpAPI)
cd /opt/cannibalization-system
npm run pull:gsc -- --window=90
npm run pull:gsc -- --window=180
npm run pull:gsc -- --window=365
npm run embed:articles    # 新規記事のみ
npm run embed:north-star
npm run embed:centroids
npm run embed:pairs
npm run pull:serp-overlap -- --limit=200
npm run decide:cell-relation
npm run decide:run
```

cron 化する場合 (毎月1日 03:00):
```cron
0 3 1 * * cd /opt/cannibalization-system && /usr/bin/npm run pull:gsc >> /var/log/canivali-gsc.log 2>&1
```

---

## 緊急時

```bash
# サービス停止
pm2 stop cannibalization-app

# 直前のコミットに戻す
cd /opt/cannibalization-system
git log --oneline -5
git reset --hard <previous-commit-sha>
npm ci && npm run build
pm2 restart cannibalization-app
```

DB 破損時は最新の git の状態 + ローカルから `db/cannibalization.db` を scp で書き戻す。
