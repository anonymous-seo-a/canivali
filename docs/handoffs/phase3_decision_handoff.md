# Phase 3 (Decision) — Handoff Document v0.1

**前提**: Phase 2 (Semantic) DoD 完了
**作成日**: 2026-05-04 (ドラフト)
**承認者**: Daiki レビュー待ち

---

## 0. 位置づけ

Phase 2 で蓄積した「embedding + GSC + SERP」の3層シグナルを統合し、各記事/ペアに対して Decision Engine が **5-fix 拡張判定** (KEEP / CONSOLIDATE / DIFFERENTIATE / SPLIT / REASSIGN / DELETE) を自動提案する。判定は audit log に残し、Human Review UI で承認/修正を経て executed へ昇格する。

## 1. Phase 3 完成定義 (DoD)

1. ✅ Decision Engine が全 in_scope 記事 + 高/中 severity ペアに対して action 候補を出している
2. ✅ 各 decision に rationale_json (寄与因子 + スコア) が記録されている
3. ✅ Human Review UI から decision を承認/修正できる
4. ✅ confidence_score の分布が見え、高 (>0.85) は自動承認可、中 (0.6-0.85) は要確認、低 (<0.6) は要レビューの3層
5. ✅ Pilot セル (D1×V1) の 6 記事 (handoff §6.4) について判定を出し、handoff doc の予測と突合した精度レポートがある

## 2. 判定の基本フロー

```
入力: master_articles, cannibalization_pairs, gsc_query_url_snapshots, article_performance_snapshots
        + master_topics.centroid_vector + business_relevance_score

Stage 1: 単独記事の評価
  - business_relevance_score < 0.5 → DELETE 候補 (汚染)
  - performance が極端に低い (clicks=0, impressions<10) → DELETE 候補
  - subtopic_topic_id が title-based で confidence ≤ 0.4
    かつ embedding-based で別セルに近い → REASSIGN 候補

Stage 2: ペアの評価
  - cosine ≥ 0.95 + serp_overlap ≥ 0.8 → CONSOLIDATE 確定 (winner = clicks/impressions が高い方)
  - cosine ≥ 0.9 + serp_overlap 0.5-0.8 → CONSOLIDATE 候補 (要レビュー)
  - cosine ≥ 0.85 + serp_overlap < 0.3 → DIFFERENTIATE (意図が違う)
  - 同セル × cosine ≥ 0.85 → 強カニバリ (CONSOLIDATE優先)
  - 異セル × cosine ≥ 0.85 → REASSIGN or SPLIT を検討

Stage 3: SPLIT 検出
  - 1記事内に複数の subtopic シグナル (例: D1 + E1 ハイブリッド) → SPLIT 候補
  - 検出方法: 本文を段落単位で embedding し、subtopic centroid との距離分布を見る
```

## 3. 主タスクと推奨実装順序

### Step 1: ペア関係の cell-mapping
- `cannibalization_pairs` に「同セル / 同subtopic異V / 異subtopic同V / 全異」のラベルを追加
- migration 0.3.0 で `pair_relation` カラム追加

### Step 2: Winner 選定ロジック
- 各 CONSOLIDATE 候補ペアで「どちらが残るか」決定
- 因子: clicks (重み 0.5) + impressions (0.3) + business_relevance_score (0.2)
- 同点なら新しい記事 (last_modified が新しい方)

### Step 3: Decision Engine (純粋関数)
- 入力: 記事 or ペアのメトリクス一式
- 出力: action + confidence + rationale_json
- 純粋関数として実装 → unit test で全分岐をカバー

### Step 4: バッチ実行
- 全 in_scope 記事 + 全 high+medium ペアに対して engine を回す
- decision_log に投入

### Step 5: Human Review UI
- 既存 React UI を拡張
- decision_log を一覧表示、フィルタ (action, confidence, human_reviewed)
- 1クリックで承認 / 修正 (action 変更) / 却下
- master_articles の subtopic/V を直接編集できる詳細画面

### Step 6: Pilot セル評価
- D1×V1 の 6 記事 (11077 / 13032 / 13149 / 13595 / 13673 / 22416) の判定を engine に出させ、
  Strategic Layer の予測 (handoff doc §6.4) と比較
  - 予測: 11077 KEEP, 13149 CONSOLIDATE→11077, 13673 DIFFERENTIATE, 13595 SPLIT, 22416 DIFFERENTIATE, 13032 REASSIGN
  - engine の判定がどれだけ一致するかを report.md にまとめる

## 4. Stage 1 の閾値 (Phase 2 実測ベース)

Phase 2 の business_relevance_score 分布:
- 0.7-0.8: 34 (D1/E1 ピラー、ど真ん中)
- 0.6-0.7: 391 (大多数)
- 0.5-0.6: 4 (周辺)

→ DELETE/汚染 判定は < 0.5。実際には 1件もこの帯に入らないが、長期運用で新規記事追加時に効く。

## 5. SerpAPI 制約と運用

- 上位 200 ペア × 5 query = 最大 1,000 calls
- $50 プランで月 5,000 calls → 月次更新で十分
- shared queries (GSC で実際に両者が出る) のあるペアにのみ叩く設計で、無駄打ちを排除

## 6. 注意点

### 6.1 同セル定義
- subtopic_topic_id + vocabulary_topic_id の両方が一致 = 同セル
- subtopic だけ一致 / V だけ一致 はそれぞれ別カテゴリ

### 6.2 タイトル分類の更新
- Phase 1 の title-based 仮割当 (`classification_method='title_based'`) を Phase 3 の embedding ベース判定で上書き候補にする
- `classification_method='embedding_based'` で記録

### 6.3 quarantine='confirmed' の扱い
- decision_log には DELETE 候補としては出さない (既に範囲外 = NOINDEX or 移動済み扱い)
- ただし、新規流入で confirmed が増える可能性があるため監視は必要

### 6.4 Pilot 拡張時のリスク
- D1×V1 が Pilot で安定したら、次は D1×V5-1 (アコム) や A3×V1 (主婦) など軸別に展開
- 1セルあたりの記事数が少ないと統計的判断が弱くなる → cell内 N≥3 を最低条件に

## 7. 既知の懸念

- **強カニバリの大量検出**: Phase 2 で cosine≥0.85 が 33,000 ペア。Decision Engine が逐一処理するとスケールしない。severity=high (cosine≥0.9) の 7,318 ペアから着手すること。
- **SPLIT 判定の難しさ**: 1記事を分割すべきかは embedding だけでは判らない。Claude API でセクション単位の subtopic 推定を併用すべき (Step 3 を Claude prompt-based judgment に拡張)。
- **GSC データの遅延**: 直近のデータは 2-3 日遅れ。月次で snapshot しているので Phase 3 では allow される範囲。

## 8. バージョン管理

| 日付 | 変更内容 | 承認者 |
|------|---------|-------|
| 2026-05-04 | 初版ドラフト (Phase 2 mid-checkpoint) | (Daiki レビュー待ち) |
