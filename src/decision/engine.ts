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
  | 'DELETE';

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
};

export type PairMetrics = {
  pair_id: number;
  cosine_similarity: number;
  serp_overlap_pct: number | null;
  shared_queries_count: number | null;
  pair_relation: PairRelation | null;
  a: ArticleMetrics;
  b: ArticleMetrics;
};

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
// =========================================================

export function selectWinner(
  a: ArticleMetrics,
  b: ArticleMetrics,
): { winner: ArticleMetrics; loser: ArticleMetrics; score_a: number; score_b: number } {
  // パフォーマンス因子は impression 全体で割って正規化
  const totalImp = (a.impressions || 0) + (b.impressions || 0) || 1;
  const totalClk = (a.clicks || 0) + (b.clicks || 0) || 1;

  const scoreOf = (x: ArticleMetrics): number => {
    const clicksNorm = (x.clicks || 0) / totalClk;          // 重み 0.5
    const impsNorm = (x.impressions || 0) / totalImp;       // 重み 0.3
    const relNorm = x.business_relevance_score ?? 0;        // 重み 0.2 (0..1)
    return 0.5 * clicksNorm + 0.3 * impsNorm + 0.2 * relNorm;
  };

  const sa = scoreOf(a);
  const sb = scoreOf(b);
  if (sa >= sb) return { winner: a, loser: b, score_a: sa, score_b: sb };
  return { winner: b, loser: a, score_a: sa, score_b: sb };
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

  // === Same cell (subtopic + V 両方一致) ===
  if (p.pair_relation === 'same_cell') {
    if (p.cosine_similarity >= 0.95) {
      factors.push('same_cell', 'cosine>=0.95');
      return {
        action: 'CONSOLIDATE',
        confidence: 0.95,
        target_article_id: winner.article_id,
        target_url: winner.url,
        rationale: { factors, scores },
      };
    }
    if (p.cosine_similarity >= 0.9) {
      factors.push('same_cell', 'cosine>=0.9');
      return {
        action: 'CONSOLIDATE',
        confidence: 0.85,
        target_article_id: winner.article_id,
        target_url: winner.url,
        rationale: { factors, scores },
      };
    }
    factors.push('same_cell', 'cosine_in_0.85-0.9');
    return {
      action: 'CONSOLIDATE',
      confidence: 0.7,
      target_article_id: winner.article_id,
      target_url: winner.url,
      rationale: { factors, scores },
    };
  }

  // === SERP データがある場合の強シグナル ===
  if (p.serp_overlap_pct !== null && p.serp_overlap_pct >= 0.5) {
    factors.push('serp_overlap>=0.5');
    return {
      action: 'CONSOLIDATE',
      confidence: 0.75,
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
