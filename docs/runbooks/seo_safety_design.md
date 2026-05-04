# Runbook: SEO 安全性設計 (Phase 5)

## 設計の前提

CONSOLIDATE 判定は SEO に影響する破壊的操作。誤判定したら順位を失う。
このドキュメントは「engine の判定が SEO 観点で安全か」を保証する仕組みをまとめる。

## 4 つの安全機構

### 1. KW jaccard ゲート

**問題**: cosine 類似度は本文の意味類似度を測るが、ユーザー意図は捉えない。
本文が 95% 似ていても、Google が両者を異なるクエリで上位表示しているなら、
実質的に異なる意図を満たしている = 統合すると検索流入を半分失う。

**対策**: GSC 90日窓の top-10 KW (impressions ≥5) の jaccard 類似度をペアごとに計算し、
gate として CONSOLIDATE 判定に使う。

```
jaccard >= 0.30  : 強い意図一致 → CONSOLIDATE 高信頼 (conf ≥0.93)
jaccard >= 0.15  : 部分一致     → CONSOLIDATE 標準
jaccard >= 0.05  : 弱い一致     → CONSOLIDATE 低信頼 (conf 0.6-0.7)
jaccard <  0.05  : 意図違い     → DIFFERENTIATE に降格
```

ただし両者の impressions が低い (新規/低トラフィック) 場合はゲート無効化。

### 2. Chain resolution

**問題**: 各ペアは独立に判定されるため、A→B、B→C が両方 CONSOLIDATE 判定されると
A→B→C のチェーン (2-hop redirect) が発生。link juice 希釈 + UX 悪化。

さらに極端な例: A→B、B→C、C→A のループも理論上発生しうる
(`CHECK (article_a_id < article_b_id)` で同一ペア逆向きは防いでるが、
独立した 3 ペアの組み合わせは止められない)。

**対策**: グラフ走査で:
- チェーン: A→B→C を **A→C** に短縮 (1-hop に圧縮)
- 循環: A→B→C→A で最高 traffic ノードを canonical に選び、他を canonical に向ける

実装: `src/lib/redirect-deploy.ts: resolveChains()`

### 3. baseline + 28日 lift verification

**問題**: 統合実行が SEO 改善したか測れない。

**対策**: `consolidation_executions` テーブルに実行直前の (loser+winner) 90日 GSC を baseline として保存。
T+28 で `npm run decide:lift` を回すと、winner の最新 GSC と baseline_combined を比較し、
lift_clicks_pct を算出。

判定:
- lift > 0 = 統合成功 (両者の流入を winner が吸収できている)
- lift < -10% = 失敗 (人間レビュー、必要なら roll back)

### 4. .htaccess による真の 301 リダイレクト

**問題**: WP の status='draft' は loser URL を 404 にする = 過去のリンク資産が消失。

**対策**: `/no1/.htaccess` の `# BEGIN canivali` ブロックに `RewriteRule [R=301,L,QSA]` を書き、
loser URL を winner URL に確実に 301 で転送。
書き込みは VPS から SSH 経由、既存ルールには触れず BEGIN/END マーカー間のみ置換。

---

## 推奨運用フロー (Phase 5+)

```
週次オペレーション
  1. ダッシュボードで lift_pct を確認 (前週の measured を見る)
  2. ① 候補をレビュー で 統合フィルタ
     - 信頼度「高のみ」(conf 0.85+) は KW gate を通った安心セット
     - 上から 5-10 件「承認」
  3. ② 実行プレビュー で 承認済モードに切替
     - 🔗 チェーン警告が出てたら詳細を確認
     - 🛡️ 301 リダイレクトを反映 (htaccess 更新)
     - 🧪 dry-run でログ確認 → 🚀 すべて本実行 (WP draft化 + baseline 記録)
  4. 4 週間後の lift 計測まで待機

月次オペレーション
  - npm run pull:gsc                      # 最新 GSC
  - npm run decide:kw-analysis            # KW jaccard 再計算
  - npm run decide:run                    # engine 再評価
  - npm run decide:lift                   # 過去実行の lift 集計
  - ダッシュボードで判断
```

## 失敗時のロールバック

1. WP 管理画面で loser 記事の status を draft → publish に戻す (URL 復活)
2. `/no1/.htaccess` の canivali ブロックから該当 RewriteRule を手動削除
   (またはバックアップ `/no1/.htaccess.bak.<ts>` を復元)
3. `consolidation_executions.lift_status='rolled_back'` に手動更新
