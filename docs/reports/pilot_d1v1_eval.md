# Pilot D1×V1 — Decision Engine Evaluation

本レポートは Phase 0 handoff §6.4 の予測判定と Phase 3 Decision Engine の出力を突合する。

## 1. 単独記事評価

| ID | 予測 | engine | 一致 | confidence | subtopic | V | relevance |
|----|------|--------|------|-----------|----------|---|-----------|
| 11077 | KEEP | KEEP | ✅ | 0.70 | D1 | V1 | 0.703 |
| 13032 | REASSIGN | KEEP | ❌ | 0.70 | B1 | V1 | 0.727 |
| 13149 | CONSOLIDATE | KEEP | ❌ | 0.70 | D1 | V1 | 0.697 |
| 13595 | SPLIT | KEEP | ❌ | 0.70 | E1 | V1 | 0.711 |
| 13673 | DIFFERENTIATE | KEEP | ❌ | 0.70 | E1 | V1 | 0.700 |
| 22416 | DIFFERENTIATE | KEEP | ❌ | 0.70 | E4 | V1 | 0.720 |

**単独記事の予測一致率**: 1/6 (17%)

注: 単独記事レベルでは engine は KEEP/REASSIGN/DELETE しか出さない設計のため、CONSOLIDATE/DIFFERENTIATE/SPLIT はペア評価で検出される。

## 2. Pilot 6 記事間のペア判定

| pair | a→b | cosine | serp_overlap | rel | engine | conf | winner | target |
|------|-----|--------|--------------|-----|--------|------|--------|--------|
| 3556 | 13032 → 13149 | 0.974 | 0.00 | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 3967 | 13149 → 13673 | 0.974 | 0.00 | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 1075 | 11077 → 13149 | 0.969 | 0.00 | same_cell | CONSOLIDATE | 0.95 | 13149 | 13149 |
| 1105 | 11077 → 13673 | 0.968 | 0.00 | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 3589 | 13032 → 13673 | 0.964 | 0.00 | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 9252 | 13595 → 22416 | 0.962 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 3890 | 13032 → 22416 | 0.960 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 1091 | 11077 → 13595 | 0.959 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 1074 | 11077 → 13032 | 0.957 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 1399 | 11077 → 22416 | 0.955 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 13148 | 13673 → 22416 | 0.954 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 4267 | 13149 → 22416 | 0.953 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 8957 | 13595 → 13673 | 0.951 | — | same_cell | CONSOLIDATE | 0.95 | 13595 | 13595 |
| 3950 | 13149 → 13595 | 0.951 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |
| 3572 | 13032 → 13595 | 0.950 | — | diff_subtopic_same_v | KEEP | 0.70 |  | — |

## 3. 解釈

### 予測通り出るべきもの
- **13149 → 11077 CONSOLIDATE**: handoff §6.4 強カニバリ確定。pair で 11077↔13149 が CONSOLIDATE & winner=11077 か?
- **13673 DIFFERENTIATE**: 「選び方」軸に純化。同 D1×V1 セルなのでペア判定が鍵。
- **22416 DIFFERENTIATE**: メリット・デメリット軸 = E4 ハイブリッド扱い。
- **13032 REASSIGN to D2**: D2 (B1 即日 × 低金利) のピラーへ。subtopic 仮割当が D1 になっている可能性が高く REASSIGN 候補に出るはず。

### Engine 限界
- **13595 SPLIT**: 現状の engine は SPLIT を出さない (Phase 3 拡張)。
- **REASSIGN の target** (どこへ): engine は move 先を決めない (Phase 3 拡張、embedding centroid との距離で決定)。
