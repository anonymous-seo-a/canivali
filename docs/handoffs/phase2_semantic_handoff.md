# Phase 2 (Semantic) — Handoff Document v0.1

**前提**: Phase 1 (Foundation) DoD 完了
**作成日**: 2026-05-04
**承認者**: 待機中

---

## 0. 位置づけ

Phase 1 で構築した記事インベントリと topics マスターに対して、embedding と SERP 実態を重ねて「カニバリ候補ペアの抽出」までを完成させる。

## 1. Phase 2 完成定義 (DoD)

1. ✅ `master_articles.article_embedding` が in_scope 全記事に付与済み (text-embedding-3-large)
2. ✅ `master_topics.centroid_vector` が全 subtopic / V軸セルに付与済み
3. ✅ business_relevance.md の embedding が `business_relevance_embeddings` テーブル (新設) に保存済み
4. ✅ 各記事に business_relevance_score (cosine 類似度) が付与済み
5. ✅ `cannibalization_pairs` に cosine ≥ 0.85 のペアが抽出済み (件数想定: 数百〜千)
6. ✅ 上位ペアの SERP overlap_pct が SerpAPI 経由で計算済み
7. ✅ `gsc_query_url_snapshots` に直近 6ヶ月分の GSC データが投入済み
8. ✅ 要判定 5件 (17549, 14056, 14077, 22431, 22539) の `category_quarantine` が `pending` → `in_scope` or `confirmed` に確定済み
9. ✅ Phase 3 への引き継ぎ事項が `docs/handoffs/phase3_decision_handoff.md` に記述済み

## 2. 主タスクと推奨実装順序

### Step 1: 記事 embedding 生成
- `src/embedding/generate-article-embeddings.ts` 新設
- OpenAI text-embedding-3-large
- 入力: `body_text` (truncate to 8192 tokens)
- 出力: `master_articles.article_embedding` (BLOB, Float32Array)
- バッチ実行 (50件ずつ、レート制限注意)
- コスト見積: 434 × 平均5000字 ≈ 2.2M tokens ≈ $0.30

### Step 2: business_relevance 北極星の embedding
- 新テーブル `business_relevance_embeddings (id, version, content_hash, embedding, created_at)` を作る
- `business_relevance.md` の §1 確定ステートメント (180字) を embedding 化
- バージョン管理 (handoff doc が更新されたら再 embedding)

### Step 3: 各記事の business_relevance_score
- 全 in_scope 記事 vs 北極星 の cosine
- `master_articles.business_relevance_score` カラムを migration で追加 (0.2.0)
- 低スコア記事 (例: < 0.4) は手動レビュー対象として `category_quarantine='pending'` に格上げ

### Step 4: 要判定 5件の確定
- 17549, 14056, 14077, 22431, 22539 の本文 embedding を北極星と比較
- 閾値以上 → `in_scope`、未満 → `confirmed` (汚染確定)
- audit_log に判定根拠を記録

### Step 5: topic centroid 計算
- 各 subtopic / V軸 セルに属する記事 embedding の平均
- Outlier (cosine 0.5未満の記事) は除外して centroid 計算
- `master_topics.centroid_vector` に保存
- `centroid_updated_at` も更新

### Step 6: ペア類似度行列
- 全 in_scope 記事ペア (n=424 → 約 90k ペア) で cosine 計算
- メモリ上で計算可、必要なら chunked
- cosine ≥ 0.85 のペアを `cannibalization_pairs` に挿入
- severity = 高 (≥0.9) / 中 (0.85-0.9) / 低 (0.80-0.85) を初期付与

### Step 7: GSC 実データ pull
- `src/ingestion/gsc-pull.ts` 実装
- 過去 90 / 180 / 365日の `(query, url)` データ
- `article_performance_snapshots` と `gsc_query_url_snapshots` に投入
- 注意: GSC は最大 16ヶ月。バックフィルは早期に

### Step 8: SERP overlap 計算
- 上位ペア (cosine ≥ 0.9 など、コスト管理) のみ SerpAPI で SERP top10 取得
- Jaccard で overlap_pct 計算
- `cannibalization_pairs.serp_overlap_pct` に保存

## 3. 参考: Phase 1 で揃ったもの

- `master_articles` 434件 (in_scope 424, pending 5, confirmed 5)
- 各記事に title-based の `subtopic_topic_id` / `vocabulary_topic_id` 仮割当 (confidence 0.1〜0.7)
- `master_topics` (subtopic 軸 6 + 1 pillar + 51 中分類 + V軸 92)
- Pilot KW 22件 (D1×V1)
- Strategic Layer 3 ファイル (`docs/strategic/`)

## 4. 注意点

### 4.1 タイトル仮分類は信用しない
Phase 1 の `classification_method='title_based'` は confidence ≤ 0.7 の暫定。
embedding ベースで上書き or 補強する場合、`classification_method='embedding_based'` で記録。

### 4.2 quarantine 'confirmed' は embedding しない
カテゴリ汚染が確定した5件は cardloan の意味空間外なので、centroid 汚染を避けるため embedding 対象から除く。pending 5件は Step 4 で先に判定して in_scope/confirmed に振り分けてから embedding。

### 4.3 SERP コスト管理
SerpAPI は 1 query = $0.005 程度。全 90k ペアでは絶対に回さない。cosine 上位だけに絞る。

### 4.4 GSC API のクォータ
1 日あたり 25,000 リクエスト。クエリ × URL の dimension で取ると行数が膨らむ。`startRow` でページング。

## 5. 想定スケジュール

```
Day 1: Step 1, 2 — 記事 + 北極星 embedding
Day 2: Step 3, 4 — relevance score + 要判定確定
Day 3: Step 5, 6 — centroid + ペア抽出
Day 4-5: Step 7 — GSC バックフィル
Day 6-7: Step 8 — SERP overlap
Day 8: Phase 3 handoff ドラフト
```

## 6. 既知の懸念

- 「2026年」が大量にタイトル末尾にあるため、embedding が年表記の差で揺れる可能性。本文を主に embedding するので影響は限定的だが、念のため title vs body 両方の embedding を持つ設計にしておくと Phase 3 で柔軟。
- D1×V1 ピラー6件 (handoff doc §6.4) は Phase 4 で個別検証する。Phase 2 段階では一旦カニバリペアとして検出されるはず。

---

## 7. バージョン管理

| 日付 | 変更内容 | 承認者 |
|------|---------|-------|
| 2026-05-04 | 初版ドラフト (Phase 1 完了直前) | (Daiki レビュー待ち) |
