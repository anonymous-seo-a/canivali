# Claude サブスク 一気通貫相談プロンプト

これを **claude.ai** にそのままコピペしてください。
返ってきた回答を、こちらの作業中の Claude Code セッションに貼り戻すと、私が実装に反映します。

---

## ✂️ ここから下を全文コピペ ↓

```text
# Role

あなたは SEO とテクニカル検索分析のシニアコンサルタントです。
日本の金融メディアサイト (soico.jp) のカードローン領域 434 記事に対して
記事カニバリゼーションを自動検出・統合する Node.js システムが稼働中です。
私 (依頼者) はこのシステムの判定ロジックの妥当性をレビューしてもらい、
具体的な数値調整・追加シグナル・失敗回避策を提示してほしい。

# 現状システムの全体像

## データソース
- Voyage `voyage-3-large` (1024dim) で全記事 embedding 済 (本文+タイトル)
- 北極星 (事業ステートメント文) embedding と各記事 embedding の cosine = `business_relevance_score`
- 各 subtopic / 商品軸 (V) の centroid 計算済
- GSC 90/180/365日窓のクエリ×URL データ (68,691 行 / 433 記事 / 38,485 ユニーククエリ)
- SerpAPI で上位 200 高 cosine ペアの SERP overlap を計測済 (856 calls)

## トピック構造 (二次元)
- subtopic 軸 (A〜G の 51 中分類): A=属性, B=条件, C=目的, D=比較ピラー, E=教養, F=実務, G=トラブル
- 商品軸 V (92 種): V1=カードローン, V2=キャッシング, V5-1=アイフル, V6-1=三菱UFJ ...

## 判定アクション (5-fix)
KEEP / CONSOLIDATE (統合) / DIFFERENTIATE (差別化) / SPLIT (分割) / REASSIGN (分類変更) / DELETE

## CONSOLIDATE 判定ルール (現在)
ペア (記事A, 記事B) の cosine_similarity, kw_jaccard, serp_overlap_pct, pair_relation を見て:

```
1. quarantine='confirmed' 含む → KEEP
2. KW jaccard < 0.05 + 両者 impressions > 50 → DIFFERENTIATE (intent_diverged)
3. same_cell (subtopic+V 一致):
   - cosine ≥0.95: CONSOLIDATE
     - jaccard ≥0.30: conf 0.97
     - jaccard ≥0.15: conf 0.93
     - else:          conf 0.85
   - cosine ≥0.90: CONSOLIDATE conf 0.75-0.85
   - cosine 0.85-0.90: CONSOLIDATE conf 0.6-0.72
4. cross-cell + (kw_jaccard ≥0.30 or serp_overlap ≥0.5) → CONSOLIDATE conf 0.78
5. same_subtopic_diff_v: → DIFFERENTIATE (商品比較として両立)
6. diff_subtopic_same_v: → KEEP (同商品の異テーマ)
7. fully_different + 高 cosine: → KEEP (低 confidence)
8. unclassified: → REASSIGN
```

## winner 選定ロジック
score(article) = 0.5 × clicks_normalized + 0.3 × imps_normalized + 0.2 × business_relevance_score
(normalize は両者 sum で割る)

## 実データの判定結果
- 全ペア: 60,477 (cosine ≥ 0.80 の組合せ)
- 同セル: 263 ペア (subtopic+V 両方一致)
- CONSOLIDATE: 181 件 (KW gate 適用後; 元 287 件)
- DIFFERENTIATE: 3,792 件
- REASSIGN: 10,148 件
- auto-承認可 (conf ≥ 0.85): 53 件

## チェーン解決
loser→winner のグラフを走査し:
- A→B→C → A→C に短縮 (1-hop に圧縮)
- A→B→C→A の循環は最高 traffic を canonical に選び他を向ける

現在の auto モードで: 40 件中 4 件のチェーン検出、循環なし。

## 統合実行の中身
- WP REST API で loser を status=draft に変更
- Xserver の /no1/.htaccess に `RewriteRule ... [R=301,L,QSA]` を追加 (BEGIN/END canivali マーカー間のみ更新)
- baseline (実行直前 90日 GSC clicks/imps) を `consolidation_executions` に保存
- T+28 日後に `decide:lift` で実測値と比較し lift_pct を算出

# Pilot 評価で判明した具体例

## 例1: 11077 vs 13149 (両方カードローンおすすめ系)
- cosine 0.969 (same_cell, D1×V1)
- 11077: 15 clicks / 8,591 imp / pos 5.9 / relevance 0.703 / タイトル「人気10社を徹底比較」
- 13149: 38 clicks / 14,936 imp / pos 6.4 / relevance 0.697 / タイトル「10社を徹底比較」
- engine の winner = 13149 (clicks 多)
- 元仮説 (人間) = 11077 を canonical に
- engine の判定: CONSOLIDATE 13149←11077

## 例2: 13595 (圧倒的トップ記事)
- 「カードローンとは？おすすめ5社比較と失敗しない選び方」
- 90日 536 clicks / 50,623 imp / pos 4.1 / relevance 0.711
- 5 つの記事が「13595 へ統合」と判定されている (winner として大量受け入れ)
- ambiguity score でも上位: top1 E1 (概念定義), top2 D1 (商品比較) の margin 0.000 → SPLIT 候補とも判定
- engine は同時に「CONSOLIDATE の winner」と「SPLIT 推奨」の二つの判定を出している

## 例3: KW jaccard = 0 のペア
全 CONSOLIDATE 候補 287 件のうち 185 件が KW jaccard = 0 (両者 GSC で共通する上位 KW なし)。
KW gate で 102 件除外 (両者 impressions > 50 のもの) して 181 件まで減らした。

# 私の質問

以下 5 点について、**具体的な数値と式とコード片レベル**で回答してください。
「気を付けてください」「考慮しましょう」のような抽象論ではなく、
「閾値 X を Y に変更」「式に Z を追加」「以下のテストケースで検証」レベルで。

---

## Q1: CONSOLIDATE 判定ルールの妥当性
ルール 1〜8 で「本来統合すべきでないペアを統合してしまう」典型的失敗パターンを 3 つ挙げ、
それぞれに対するルール追加を提示してください。
出力例: 「失敗 N: 説明 / 検出条件 (具体的な閾値) / 追加ルール (どこに insert)」

## Q2: winner 選定の式
現在の式: `0.5×clicks + 0.3×imps + 0.2×relevance`
追加すべき信号 (バックリンク数、公開日、URL 短さ、最終更新日、内部リンク数 等) を優先順位付けし、
推奨重みを提示してください。例 1 (11077 vs 13149) で適用した場合の予測 winner も。

## Q3: KW jaccard = 0 + 高 cosine + 同セル のペア
これらを統合するか別記事として残すかの判定基準を提示してください。
具体的に: どの追加データを取れば判別できるか、判別できない時のデフォルト挙動 (CONSOLIDATE か DIFFERENTIATE か)、
判別フローを擬似コードで。

## Q4: 13595 (圧倒的トップ記事) の扱い
SPLIT 判定と CONSOLIDATE winner 判定が両方出た場合の優先ルールを提示してください。
具体的に: clicks > X 件以上の記事に対して SPLIT 判定を抑制すべきか、
両方の判定が並走可能なケース (子記事を派生させつつ親に canonical) があるなら設計を。

## Q5: チェーン解決の SEO リスク
A→B→C を A→C に短縮する際、B が「捨てられる」ことの SEO 影響を整理してください。
- B が他サイトから被リンクを受けていた場合の影響
- B も .htaccess で 301 すべきか (現在は B の URL は draft 化される設計)
- canonical タグと .htaccess 301 の併用ベストプラクティス

# 出力フォーマット要求

以下のフォーマットの Markdown で:

```markdown
## Q1 失敗パターンと追加ルール
### 失敗パターン 1: <名前>
- 検出条件:
- 追加ルール (insert 位置):
- 期待効果:
### 失敗パターン 2: ...
### 失敗パターン 3: ...

## Q2 winner 選定の改善式
新式: score(a) = ...
新規シグナルの取得方法:
例1への適用: 11077 score = X.XX, 13149 score = X.XX → winner = ?

## Q3 KW jaccard 0 + 高 cosine + 同セル
追加データ案:
判別擬似コード:
デフォルト挙動:

## Q4 13595 の扱い
SPLIT vs CONSOLIDATE winner の優先ルール:
clicks > N の記事の特例:
共存設計の可能性:

## Q5 チェーン解決の SEO リスク
B 記事の処理: (具体的アクション)
.htaccess + canonical 併用設計:
ロールバック手順:

## 全体総括 (Top 3 priorities)
1. 最優先で実装すべき変更:
2. 次点:
3. 余裕があれば:
```
```

## ✂️ ここまで全文コピペ ↑

---

## 受け取り後の流れ

1. 上記プロンプトを `claude.ai` に貼り付ける (Sonnet 4.6 or Opus 推奨。Pro/Max なら長文 OK)
2. 返ってきた Markdown 全体を、Claude Code (こちら) のチャットに貼り戻す
3. 私が **Q1-Q5 の各推奨を実装に落とし込む** (engine.ts 修正、新シグナル追加、テスト追加など)
4. 変更を `decide:run` で再実行 → 新しい判定数を見せる
5. 必要なら 2 回目の相談プロンプト (deep dive) を出す

## 補足: 他の Claude にこの相談をさせる際のポイント

- **「具体的な数値」を強く要求** している → 抽象論回答を防げる
- **実データ (例1〜3)** が含まれているので Claude が現場感を持って答えやすい
- **出力フォーマット要求** が明確 → 私が解釈・実装しやすい
- 1 回で全部聞いているので、Claude.ai のスレッド消費が最小

回答が短すぎる/抽象的な場合は「Q1 についてもっと具体的な実装コード片を」のように追加質問してください。
