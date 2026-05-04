# Claude サブスク相談用プロンプト集

このドキュメントは、cannibalization-system の判定アルゴリズムや戦略について
Claude (claude.ai のサブスクなど) で別途相談する際の入力プロンプト集。

各プロンプトは独立して使えるよう、必要な背景情報を内包しています。

---

## A. 統合 (CONSOLIDATE) の判定基準が妥当かレビュー

```
あなたはテクニカル SEO の上級コンサルタントです。
私は soico というサイトの cardloan/ カテゴリ (434記事) でカニバリゼーション解消の
自動判定システムを構築しました。CONSOLIDATE (統合) 判定の安全性を評価してください。

## 現在の判定ロジック

ペア (記事A, 記事B) に対して以下の順で判定:

1. quarantine='confirmed' 含む → KEEP (skip)
2. KW jaccard < 0.05 かつ両者 impressions > 50 → DIFFERENTIATE (intent_diverged)
3. same_cell (subtopic 一致 + 商品軸 V 一致):
   - cosine ≥ 0.95: CONSOLIDATE
     - jaccard ≥ 0.30: confidence 0.97
     - jaccard ≥ 0.15: confidence 0.93
     - else:           confidence 0.85
   - cosine ≥ 0.90: CONSOLIDATE conf 0.75-0.85
   - cosine 0.85-0.90: CONSOLIDATE conf 0.6-0.72
4. cross-cell (subtopic 違い or V違い) で kw_jaccard ≥ 0.30 or serp_overlap ≥ 0.5
   → CONSOLIDATE conf 0.78
5. same_subtopic_diff_v: 商品比較として両立可 → DIFFERENTIATE
6. diff_subtopic_same_v: 商標違いの異テーマ → KEEP
7. fully_different: 内容類似だがカテゴリ違い → KEEP (低confidence)
8. unclassified: 軸が不明 → REASSIGN

## メトリクス定義

- **cosine**: Voyage voyage-3-large embedding (1024次元) の (タイトル+本文) cosine
- **kw_jaccard**: GSC 90日窓 impressions≥5 の top-10 KW 集合の jaccard
- **serp_overlap_pct**: 共通 GSC クエリで Google top-10 に両者が出る割合
- **pair_relation**: subtopic_topic_id (例 D1) と vocabulary_topic_id (例 V1) の組合せ一致

## winner 選定

CONSOLIDATE 時にどちらを残すか:
score = 0.5 × clicks_norm + 0.3 × imps_norm + 0.2 × business_relevance_score
(business_relevance_score = 北極星 = サイト戦略文の embedding と記事 embedding の cosine)

## 質問

1. このルールセットで「本来統合すべきでないペアを統合してしまう」典型的失敗パターンは?
2. winner 選定でバックリンク数を考慮すべきか? Ahrefs/SearchConsole のリンクデータを統合すべきタイミング
3. confidence 閾値 (0.85+ で auto, 0.6-0.85 で人手レビュー) は妥当か?
4. SERP overlap が cosine と KW jaccard の両方より弱いシグナルになっているが、
   逆に SERP overlap を強い指標として使うべきケースは?
5. 改善提案を 3 つ、優先度付きで。
```

---

## B. チェーン解決ロジックのレビュー

```
あなたは SEO とリダイレクト戦略の専門家です。
カニバリ統合システムでチェーン (A→B→C) と循環 (A→B→C→A) を自動解決する
グラフアルゴリズムを書きました。レビューしてください。

## 現状のロジック

入力: loser→winner のペア集合 (各 pair_id ごとに独立判定された結果)

```
function resolveChains(rules, trafficScore, urlOf) {
  for each loser:
    follow winner chain until terminal
    if cycle detected:
      pick canonical = highest trafficScore in cycle
      all other cycle members → canonical
    else:
      record chain (intermediate nodes also map to terminal)
}
```

trafficScore = clicks * 10 + impressions

## 質問

1. このアルゴリズムで「最適な canonical」を選べているか? clicks 優先で良い?
2. 循環内に元々別意図の記事が混ざる可能性。それを検出する方法は?
3. SEO の link equity 観点で、A→B→C を A→C に短縮することの本当のメリット/デメリット?
   - メリット: hop 削減
   - デメリット候補: B がもし他サイトからリンクされていた場合、A→C にすると B の被リンクが孤立
4. 「直接 A→C にしてしまうと B が残ったままで content thin になる」 → B も .htaccess で 301 すべき?
5. canonical タグと .htaccess 301 の併用ベストプラクティス
```

---

## C. KW jaccard が極端に低い (= 0) ケースの解釈

```
あなたは検索アナリストです。
私のシステムで cosine ≥ 0.85 (本文意味類似度高) のペアのうち、
65% が KW jaccard = 0 (GSC で共通する上位 KW なし) と判定されました。

## 解釈の選択肢

1. Google が既に両者を別意図と判断していて、別 KW で上位表示している → 統合しない方が良い
2. 一方が低トラフィックで GSC データが薄く、jaccard 計算が不正確
3. 内容は似ているが title 等の表面的差異で別 KW にマッチしている (近いが別市場)
4. 我々の TOP-10 KW (impressions ≥5) の閾値が高すぎる

## 私の現在の対応

両者の impressions > 50 のペアのみ jaccard ゲートを適用 (低トラ pair はゲート無効)。
それでも 102 件のペアが「両者高トラ + jaccard=0」で CONSOLIDATE 候補から外された。

## 質問

1. このセグメント (高トラ + jaccard=0) は本当に統合すべきでないか? それとも統合した方が intent merge で良くなる?
2. impressions 閾値を下げて (例: ≥1) より多くの記事に jaccard を計算するメリット/デメリット
3. KW jaccard 以外で、本物の intent 一致を測る指標として何が考えられるか?
   - SERP top-3 に同じドメインの両 URL が並んでいるか
   - ユーザーの session continuation (1記事読んでもう片方も見るか) 
   - クリックスルーパス
```

---

## D. winner 選定の重み調整

```
私は cardloan カテゴリの記事統合システムで、CONSOLIDATE 時の winner を以下の重み付きスコアで選んでいます:

  score(article) = 0.5 × clicks_normalized
                 + 0.3 × impressions_normalized
                 + 0.2 × business_relevance_score
  (clicks_normalized = clicks / total_pair_clicks, etc)

具体例で迷っています:

ペア: 11077 vs 13149 (両方「カードローンのおすすめ」記事、cosine 0.969)

| メトリクス        | 11077 | 13149 |
|------------------|-------|-------|
| 90日 clicks      | 15    | 38    |
| 90日 impressions | 8,591 | 14,936|
| relevance score  | 0.703 | 0.697 |
| 公開日           | 2024年 | 2024年|
| URL              | shortcut形式 | shortcut形式 |

現在の score: 11077=0.30, 13149=0.43 → 13149 が winner
ハンドオフ doc は元々「11077 を canonical に」と仮説してた (おそらく URL 印象や歴史的経緯)

## 質問

1. clicks 38 vs 15 という小さな差で「データドリブンに 13149」と決めるのは妥当か?
2. 古い記事 (バックリンクが多い可能性) に重み付けすべき? 公開日を重みに入れる場合の式
3. URL の SEO 価値 (短さ、キーワード含有) を考慮すべきか?
4. 11077 の方が「人気10社」、13149 が「10社徹底比較」とタイトルに微妙な違い。
   どちらが「カードローン おすすめ」というメインクエリ意図に近いか判定するための追加データ?
5. もし両者を CONSOLIDATE するのではなく、統合せず DIFFERENTIATE すべき場合の判断基準
```

---

## E. SPLIT 検出: Claude による段落分析の精度

```
私のシステムは embedding ベースの「ambiguity score」(top-1 と top-2 subtopic centroid の差が小さい記事)
を計算し、上位 30 件を Claude に投げて「分割すべきか」を判定させています。

## プロンプト構造

「記事タイトル + 本文 6000字抜粋 + subtopic A の名前 + subtopic B の名前」を渡し、
JSON で {split_recommended: bool, rationale: 100字, section_a_excerpt, section_b_excerpt} を返させる。

結果: 30 件中 13 件が split_recommended=true。

例:
- 13595 「カードローンとは？おすすめ5社比較と失敗しない選び方」: SPLIT (E1 概念定義 + D1 比較)
- 14155 「アムザは在籍確認なし？Web完結の審査と他社比較」: SPLIT (B8 バレ対策 + E3 審査)
- 13032 「カードローンのおすすめはどこ？即日・低金利で選ぶ5社を比較」: SPLIT (D1 比較 + B1 即時性)

## 課題

13595 は GSC で 536 clicks / 50,623 impressions = 圧倒的トップ記事。
これを SPLIT してしまうと、トップ記事の権威を分散させて全体ランキングが下がる懸念。

## 質問

1. 高トラフィック記事を SPLIT する場合の SEO リスクと回避策
2. SPLIT 候補に「現在のクリック数」を入力に加えるべき (= 既に成功してる記事は触らない方が良い)?
3. SPLIT 後の親子関係はどう設計? canonical を維持したまま子記事を派生させる?
4. SPLIT 推奨と判定された後、人間レビューの観点で見るべき項目を 5 つ
5. 「枝葉として軽く触れている」レベルなのに SPLIT 推奨と Claude が判定する false positive を減らす
   prompt 改善案
```

---

## 使い方

1. Claude.ai を開く (Pro/Max サブスクならスレッドが長く保てる)
2. 上記から該当する質問を全文コピペ
3. 必要に応じてコンテキスト追加 (実データを貼る、別質問に進む)
4. 得られた知見を `docs/runbooks/` 配下にまとめ、次の改善サイクルで反映
