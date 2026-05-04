# Runbook: Recovery

## DB を完全リセットする

```bash
npm run db:reset      # *.db, *.db-wal, *.db-shm 削除
npm run db:seed       # schema + seeds 再投入
npm run crawl:soico   # 全件再取得 (約 15 分)
npm run classify:titles
npm run verify:db
```

## 一部の記事だけ再クロール

```bash
# 例: 11077 だけ再取得
npm run crawl:soico -- --id=11077

# body_text NULL の記事を一括再取得
sqlite3 db/cannibalization.db \
  "SELECT article_id FROM master_articles WHERE body_text IS NULL" |
  xargs -I{} npm run crawl:soico -- --id={}
```

## seed の差分追加

`db/seeds/*.sql` は `INSERT OR REPLACE` / `INSERT OR IGNORE` を使っているので、
既存DBに対して `npm run db:seed` を再実行しても安全。

## audit log を覗く

```bash
sqlite3 db/cannibalization.db \
  "SELECT created_at, actor, action, entity_type, entity_id, reason FROM master_audit_log ORDER BY log_id DESC LIMIT 50;"
```

## scheme migration を追加

将来テーブル追加が発生した場合:
1. `db/migrations/0002_xxx.sql` 作成
2. `seed.ts` を migrations 適用に拡張 (現状は schema.sql のみ)
3. `INSERT INTO schema_migrations (version) VALUES ('0.2.0');` で記録

Phase 1 では `schema_migrations` の運用は最低限。
