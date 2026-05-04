/**
 * Decision Engine (純粋関数群)。
 * 入力 = 記事 or ペアのメトリクス一式
 * 出力 = action + confidence + rationale_json
 *
 * 5-fix 拡張:
 *   KEEP / CONSOLIDATE / DIFFERENTIATE / SPLIT / REASSIGN / DELETE
 *
 * テスト容易性のため、すべて純粋関数。
 */

import type { PairRelation } from './cell-relation.js';

export type Action =
  | 'KEEP'
  | 'CONSOLIDATE'
  | 'DIFFERENTIATE'
  | 'SPLIT'
  | 'REASSIGN'
  | 'DELETE'
  | 'MANUAL_REVIEW'; // Phase B graph-normalize で衝突解消時に降格

export type ArticleMetrics = {
  article_id: number;
  url: string;
  title: string;
  business_relevance_score: number | null;
  classification_confidence: number | null;
  subtopic_topic_id: string | null;
  vocabulary_topic_id: string | null;
  category_quarantine: string;
  // GSC perf (90日窓)
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  // Phase 6 features
  internal_links_in: number;
  unique_brands_count: number;
  total_brand_mentions: number;
  url_quality_score: number;
  freshness_score: number;
  consolidate_winner_count: number;
};

export type PairMetrics = {
  pair_id: number;
  cosine_similarity: number;
  serp_overlap_pct: number | null;
  shared_queries_count: number | null;
  pair_relation: PairRelation | null;
  kw_jaccard: number | null;
  kw_overlap_count: number | null;
  a: ArticleMetrics;
  b: ArticleMetrics;
};

// KW jaccard ゲート閾値:
//   - >= JACCARD_HIGH:   完全に同じ意図 = CONSOLIDATE 強推奨
//   - >= JACCARD_OK:     部分一致 = CONSOLIDATE 可
//   - >= JACCARD_LOW:    不確実 = DIFFERENTIATE 推奨
//   - <  JACCARD_LOW:    意図違い = CONSOLIDATE 拒否
const JACCARD_HIGH = 0.3;
const JACCARD_OK = 0.15;
const JACCARD_LOW = 0.05;

export type Decision = {
  action: Action;
  confidence: number; // 0.0 - 1.0
  rationale: {
    factors: string[];
    scores: Record<string, number | string | boolean>;
  };
  // CONSOLIDATE/DIFFERENTIATE 等で use する付帯情報
  target_article_id?: number;
  target_url?: string;
  target_subtopic_id?: string;
  target_vocabulary_id?: string;
};

// =========================================================
// Single-article evaluation
// =========================================================

export function decideArticle(m: ArticleMetrics): Decision {
  const factors: string[] = [];
  const scores: Decision['rationale']['scores'] = {};

  // 1) 確定汚染なら DELETE 候補 (実際は noindex か redirect)
  if (m.category_quarantine === 'confirmed') {
    return {
      action: 'DELETE',
      confidence: 0.95,
      rationale: {
        factors: ['quarantine=confirmed'],
        scores: { quarantine: m.category_quarantine },
      },
    };
  }

  // 2) 北極星と乖離 (range外候補)
  if (m.business_relevance_score !== null && m.business_relevance_score < 0.5) {
    factors.push('low_relevance');
    scores.business_relevance_score = m.business_relevance_score;
    return {
      action: 'DELETE',
      confidence: 0.7,
      rationale: { factors, scores },
    };
  }

  // 3) パフォーマンス極小 + 低 relevance → DELETE 候補 (低 confidence)
  if (
    m.impressions < 10 &&
    m.business_relevance_score !== null &&
    m.business_relevance_score < 0.6
  ) {
    factors.push('low_perf', 'low_relevance');
    scores.impressions = m.impressions;
    scores.business_relevance_score = m.business_relevance_score;
    return {
      action: 'DELETE',
      confidence: 0.5,
      rationale: { factors, scores },
    };
  }

  // 4) タイトル分類が unclassified or 低 confidence → REASSIGN 候補
  if (
    m.classification_confidence !== null &&
    m.classification_confidence <= 0.4 &&
    (!m.subtopic_topic_id || !m.vocabulary_topic_id)
  ) {
    factors.push('low_classification_confidence');
    scores.classification_confidence = m.classification_confidence;
    return {
      action: 'REASSIGN',
      confidence: 0.4,
      rationale: { factors, scores },
    };
  }

  // 5) デフォルト: KEEP
  return {
    action: 'KEEP',
    confidence: 0.7,
    rationale: { factors: ['default_keep'], scores: { relevance: m.business_relevance_score ?? 0 } },
  };
}

// =========================================================
// Winner selection (CONSOLIDATE 時にどちらを残すか)
// Phase 6 改訂式 (Claude consultation Q2 反映):
//   clicks/imps の重みを縮小し、資産価値 (internal_links_in / freshness / url_quality)
//   と Google 評価 (avg_position) を重み加算。
//   バックリンク (Ahrefs 等) は未取得のため backlinks 重み 0.12 を internal_links_in に統合 (= 0.22)。
// =========================================================

export function selectWinner(
  a: ArticleMetrics,
  b: ArticleMetrics,
): { winner: ArticleMetrics; loser: ArticleMetrics; score_a: number; score_b: number } {
  const totalImp = (a.impressions || 0) + (b.impressions || 0) || 1;
  const totalClk = (a.clicks || 0) + (b.clicks || 0) || 1;
  const totalIn = (a.internal_links_in || 0) + (b.internal_links_in || 0) || 1;

  const scoreOf = (x: ArticleMetrics): number => {
    const clicksNorm = (x.clicks || 0) / totalClk;
    const impsNorm = (x.impressions || 0) / totalImp;
    const inLinksNorm = (x.internal_links_in || 0) / totalIn;
    const relNorm = x.business_relevance_score ?? 0;
    // avg_position: lower is better. 1 位 = 1.0, 100 位 = 0.0
    const positionScore = x.avg_position > 0 ? Math.max(0, 1 - x.avg_position / 100) : 0;
    const freshness = x.freshness_score ?? 0;
    const urlQ = x.url_quality_score ?? 0;
    return (
      0.25 * clicksNorm +
      0.15 * impsNorm +
      0.15 * positionScore +
      0.15 * relNorm +
      0.22 * inLinksNorm + // backlinks(0.12) + internal_links_in(0.10) を統合
      0.05 * freshness +
      0.03 * urlQ
    );
  };

  const sa = scoreOf(a);
  const sb = scoreOf(b);
  if (sa >= sb) return { winner: a, loser: b, score_a: sa, score_b: sb };
  return { winner: b, loser: a, score_a: sa, score_b: sb };
}

// =========================================================
// Hub article: SPLIT を抑制すべき主要記事の判定 (Q4)
// =========================================================
export function isHubArticle(a: ArticleMetrics): boolean {
  return (
    a.clicks >= 200 ||                  // 90日 200 clicks 以上
    a.consolidate_winner_count >= 3 ||  // 3記事以上の winner
    a.internal_links_in >= 20           // 内部権威ハブ
  );
}

// =========================================================
// Pair evaluation
// =========================================================

export function decidePair(p: PairMetrics): Decision {
  const factors: string[] = [];
  const scores: Decision['rationale']['scores'] = {
    cosine: round(p.cosine_similarity),
    relation: p.pair_relation ?? 'null',
    serp_overlap: p.serp_overlap_pct ?? -1,
    shared_queries: p.shared_queries_count ?? 0,
    kw_jaccard: p.kw_jaccard ?? -1,
    kw_overlap: p.kw_overlap_count ?? 0,
  };

  // どちらかが quarantine confirmed → ペア判定不要 (両 in_scope のみ)
  if (
    p.a.category_quarantine === 'confirmed' ||
    p.b.category_quarantine === 'confirmed'
  ) {
    return {
      action: 'KEEP',
      confidence: 0.6,
      rationale: { factors: ['skip_quarantined'], scores },
    };
  }

  const { winner, loser, score_a, score_b } = selectWinner(p.a, p.b);
  scores.winner_score = round(score_a >= score_b ? score_a : score_b);
  scores.loser_score = round(score_a >= score_b ? score_b : score_a);
  scores.winner_id = winner.article_id;

  // ====== KW ジャッカードゲート (CONSOLIDATE 判定の前提) ======
  const hasKwData =
    p.kw_jaccard !== null &&
    p.kw_overlap_count !== null &&
    (p.a.impressions > 50 || p.b.impressions > 50);
  const bothImps = Math.min(p.a.impressions, p.b.impressions);
  const posGap = Math.abs((p.a.avg_position ?? 0) - (p.b.avg_position ?? 0));

  // ====== Q1 失敗パターン 1: SERP 分離 (両者高トラ + cosine 高 + KW 0 + SERP 別) ======
  // Voyage embedding は表層意味で寄せるが、Google が別意図と判定している兆候。
  if (
    p.cosine_similarity >= 0.95 &&
    (p.kw_jaccard ?? 0) < 0.05 &&
    (p.serp_overlap_pct ?? 1) < 0.3 &&
    bothImps > 100
  ) {
    factors.push('cosine_high_but_serp_diverged');
    return {
      action: 'DIFFERENTIATE',
      confidence: 0.85,
      rationale: { factors, scores },
    };
  }

  // ====== Q1 失敗パターン 2: avg_position 乖離 ======
  // 同じ KW で一方が安定上位、他方が圏外なら、Google は両者を別評価している。
  if (posGap >= 15 && (p.serp_overlap_pct ?? 1) < 0.3 && bothImps > 50) {
    factors.push('position_gap_serp_split');
    return {
      action: 'DIFFERENTIATE',
      confidence: 0.8,
      rationale: { factors, scores },
    };
  }
  const positionPenalty = posGap >= 15 && (p.serp_overlap_pct ?? 0) >= 0.5 ? 0.1 : 0;

  // ====== Q1 失敗パターン 3: ブランド多様性ミスマッチ (比較記事 vs 単体特集) ======
  const brandGap = Math.abs((p.a.unique_brands_count ?? 0) - (p.b.unique_brands_count ?? 0));
  if (brandGap >= 5) {
    factors.push('brand_diversity_gap');
    return {
      action: 'DIFFERENTIATE',
      confidence: 0.9,
      rationale: { factors, scores },
    };
  }

  // === Same cell (subtopic + V 両方一致) ===
  if (p.pair_relation === 'same_cell') {
    if (hasKwData && (p.kw_jaccard ?? 0) < JACCARD_LOW) {
      // ====== Q3: KW jaccard 0 + 高 cosine + 同セル の 3 段判定 ======
      // Stage 1: SERP overlap が決め手
      if ((p.serp_overlap_pct ?? -1) >= 0.5) {
        factors.push('same_cell', 'kw_diverged_but_serp_aligned');
        return {
          action: 'CONSOLIDATE',
          confidence: 0.82 - positionPenalty,
          target_article_id: winner.article_id,
          target_url: winner.url,
          rationale: { factors, scores },
        };
      }
      if ((p.serp_overlap_pct ?? 1) < 0.2) {
        factors.push('same_cell', 'kw_diverged_serp_split');
        return {
          action: 'DIFFERENTIATE',
          confidence: 0.85,
          rationale: { factors, scores },
        };
      }
      // Stage 3: 中間域 → 可逆側 (KEEP) で人手レビュー要
      factors.push('same_cell', 'kw_diverged_serp_unclear', 'manual_review');
      return {
        action: 'KEEP',
        confidence: 0.4,
        rationale: { factors, scores },
      };
    }
    if (p.cosine_similarity >= 0.95) {
      factors.push('same_cell', 'cosine>=0.95');
      const conf =
        hasKwData && (p.kw_jaccard ?? 0) >= JACCARD_HIGH
          ? 0.97 - positionPenalty
          : hasKwData && (p.kw_jaccard ?? 0) >= JACCARD_OK
            ? 0.93 - positionPenalty
            : 0.85 - positionPenalty;
      return {
        action: 'CONSOLIDATE',
        confidence: conf,
        target_article_id: winner.article_id,
        target_url: winner.url,
        rationale: { factors, scores },
      };
    }
    if (p.cosine_similarity >= 0.9) {
      factors.push('same_cell', 'cosine>=0.9');
      const conf = (hasKwData && (p.kw_jaccard ?? 0) >= JACCARD_OK ? 0.85 : 0.75) - positionPenalty;
      return {
        action: 'CONSOLIDATE',
        confidence: conf,
        target_article_id: winner.article_id,
        target_url: winner.url,
        rationale: { factors, scores },
      };
    }
    factors.push('same_cell', 'cosine_in_0.85-0.9');
    return {
      action: 'CONSOLIDATE',
      confidence: (hasKwData && (p.kw_jaccard ?? 0) >= JACCARD_OK ? 0.72 : 0.6) - positionPenalty,
      target_article_id: winner.article_id,
      target_url: winner.url,
      rationale: { factors, scores },
    };
  }

  // === SERP overlap または KW jaccard が高い場合の強シグナル ===
  if (
    (p.serp_overlap_pct !== null && p.serp_overlap_pct >= 0.5) ||
    (hasKwData && (p.kw_jaccard ?? 0) >= JACCARD_HIGH)
  ) {
    factors.push('cross_cell_strong_overlap');
    return {
      action: 'CONSOLIDATE',
      confidence: 0.78,
      target_article_id: winner.article_id,
      target_url: winner.url,
      rationale: { factors, scores },
    };
  }

  // === Same subtopic, diff V (例: B1 即日 × 各商標) ===
  // → 商品比較として両立可能、ただしハブ記事への統合候補
  if (p.pair_relation === 'same_subtopic_diff_v') {
    if (p.cosine_similarity >= 0.95) {
      factors.push('same_subtopic_diff_v', 'very_high_cosine');
      return {
        action: 'CONSOLIDATE',
        confidence: 0.7,
        target_article_id: winner.article_id,
        target_url: winner.url,
        rationale: { factors, scores },
      };
    }
    factors.push('same_subtopic_diff_v', 'product_comparison');
    return {
      action: 'DIFFERENTIATE',
      confidence: 0.6,
      rationale: { factors, scores },
    };
  }

  // === Diff subtopic, same V (例: アコム の異 subtopic) ===
  // → 通常関係 (商標違いで意図同) — KEEP
  if (p.pair_relation === 'diff_subtopic_same_v') {
    factors.push('diff_subtopic_same_v', 'normal_v_axis');
    return {
      action: 'KEEP',
      confidence: 0.7,
      rationale: { factors, scores },
    };
  }

  // === Fully different (両軸異) but cosine 高 ===
  // → 怪しい (タイトル分類が間違っている可能性)、または意図差別化済
  if (p.pair_relation === 'fully_different') {
    factors.push('fully_different', 'classification_mismatch_or_differentiated');
    return {
      action: 'KEEP',
      confidence: 0.5,
      rationale: { factors, scores },
    };
  }

  // === Unclassified (片方/両方の cell が不明) ===
  factors.push('unclassified', 'reassign_then_re_evaluate');
  return {
    action: 'REASSIGN',
    confidence: 0.3,
    rationale: { factors, scores },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
