import { describe, expect, it } from 'vitest';
import { decideArticle, decidePair, selectWinner } from '../../src/decision/engine.js';
import type { ArticleMetrics, PairMetrics } from '../../src/decision/engine.js';

const baseArticle = (overrides: Partial<ArticleMetrics> = {}): ArticleMetrics => ({
  article_id: 1,
  url: 'https://x.com/1',
  title: 'sample',
  business_relevance_score: 0.7,
  classification_confidence: 0.7,
  subtopic_topic_id: 'D1',
  vocabulary_topic_id: 'V1',
  category_quarantine: 'in_scope',
  clicks: 100,
  impressions: 1000,
  ctr: 0.1,
  avg_position: 5,
  internal_links_in: 0,
  unique_brands_count: 3,
  total_brand_mentions: 30,
  url_quality_score: 0.5,
  freshness_score: 0.7,
  consolidate_winner_count: 0,
  ...overrides,
});

describe('decideArticle', () => {
  it('confirmed quarantine → DELETE', () => {
    const r = decideArticle(baseArticle({ category_quarantine: 'confirmed' }));
    expect(r.action).toBe('DELETE');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('low business_relevance_score → DELETE', () => {
    const r = decideArticle(baseArticle({ business_relevance_score: 0.3 }));
    expect(r.action).toBe('DELETE');
  });

  it('low perf + low relevance → DELETE (low confidence)', () => {
    const r = decideArticle(baseArticle({ impressions: 5, business_relevance_score: 0.55 }));
    expect(r.action).toBe('DELETE');
    expect(r.confidence).toBeLessThan(0.7);
  });

  it('low classification_confidence + missing cell → REASSIGN', () => {
    const r = decideArticle(
      baseArticle({ classification_confidence: 0.3, subtopic_topic_id: null }),
    );
    expect(r.action).toBe('REASSIGN');
  });

  it('default → KEEP', () => {
    const r = decideArticle(baseArticle());
    expect(r.action).toBe('KEEP');
  });
});

describe('selectWinner', () => {
  it('higher clicks wins', () => {
    const a = baseArticle({ article_id: 1, clicks: 1000, impressions: 5000 });
    const b = baseArticle({ article_id: 2, clicks: 100, impressions: 500 });
    const r = selectWinner(a, b);
    expect(r.winner.article_id).toBe(1);
  });

  it('relevance breaks tie when traffic equal', () => {
    const a = baseArticle({ article_id: 1, clicks: 100, impressions: 1000, business_relevance_score: 0.8 });
    const b = baseArticle({ article_id: 2, clicks: 100, impressions: 1000, business_relevance_score: 0.5 });
    const r = selectWinner(a, b);
    expect(r.winner.article_id).toBe(1);
  });
});

const basePair = (overrides: Partial<PairMetrics> = {}): PairMetrics => ({
  pair_id: 1,
  cosine_similarity: 0.9,
  serp_overlap_pct: null,
  shared_queries_count: null,
  pair_relation: 'same_cell',
  kw_jaccard: 0.1,
  kw_overlap_count: 1,
  a: baseArticle({ article_id: 1, clicks: 1000, impressions: 5000 }),
  b: baseArticle({ article_id: 2, clicks: 100, impressions: 500 }),
  ...overrides,
});

describe('decidePair', () => {
  it('same_cell + cosine ≥ 0.95 + kw_jaccard ≥ 0.15 → CONSOLIDATE high confidence', () => {
    const r = decidePair(basePair({ cosine_similarity: 0.97, kw_jaccard: 0.2, kw_overlap_count: 3 }));
    expect(r.action).toBe('CONSOLIDATE');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.target_article_id).toBe(1);
  });

  it('same_cell + cosine 0.85-0.9 → CONSOLIDATE moderate', () => {
    const r = decidePair(basePair({ cosine_similarity: 0.87 }));
    expect(r.action).toBe('CONSOLIDATE');
    expect(r.confidence).toBeLessThan(0.9);
  });

  it('serp_overlap ≥ 0.5 + non-same-cell → CONSOLIDATE', () => {
    const r = decidePair(basePair({ pair_relation: 'fully_different', serp_overlap_pct: 0.6 }));
    expect(r.action).toBe('CONSOLIDATE');
  });

  it('same_subtopic_diff_v + cosine 0.87 → DIFFERENTIATE', () => {
    const r = decidePair(basePair({ pair_relation: 'same_subtopic_diff_v', cosine_similarity: 0.87 }));
    expect(r.action).toBe('DIFFERENTIATE');
  });

  it('diff_subtopic_same_v → KEEP', () => {
    const r = decidePair(basePair({ pair_relation: 'diff_subtopic_same_v' }));
    expect(r.action).toBe('KEEP');
  });

  it('unclassified → REASSIGN', () => {
    const r = decidePair(basePair({ pair_relation: 'unclassified' }));
    expect(r.action).toBe('REASSIGN');
  });

  it('same_cell + cosine high but kw_jaccard < 0.05 + serp_split → DIFFERENTIATE', () => {
    const r = decidePair(
      basePair({
        cosine_similarity: 0.91,
        kw_jaccard: 0.02,
        kw_overlap_count: 1,
        serp_overlap_pct: 0.1,
        a: baseArticle({ article_id: 1, impressions: 5000 }),
        b: baseArticle({ article_id: 2, impressions: 3000 }),
      }),
    );
    expect(r.action).toBe('DIFFERENTIATE');
  });

  it('cross_cell with high kw_jaccard ≥ 0.3 → CONSOLIDATE', () => {
    const r = decidePair(
      basePair({
        pair_relation: 'fully_different',
        cosine_similarity: 0.86,
        kw_jaccard: 0.4,
        kw_overlap_count: 6,
        a: baseArticle({ article_id: 1, impressions: 5000 }),
        b: baseArticle({ article_id: 2, impressions: 3000 }),
      }),
    );
    expect(r.action).toBe('CONSOLIDATE');
  });

  it('Q1 fail 1: cosine high + serp diverged → DIFFERENTIATE', () => {
    const r = decidePair(
      basePair({
        cosine_similarity: 0.97,
        kw_jaccard: 0.0,
        kw_overlap_count: 0,
        serp_overlap_pct: 0.1,
        a: baseArticle({ article_id: 1, impressions: 5000 }),
        b: baseArticle({ article_id: 2, impressions: 3000 }),
      }),
    );
    expect(r.action).toBe('DIFFERENTIATE');
    expect(r.rationale.factors).toContain('cosine_high_but_serp_diverged');
  });

  it('Q1 fail 2: position gap >= 15 + serp split → DIFFERENTIATE', () => {
    const r = decidePair(
      basePair({
        cosine_similarity: 0.92,
        serp_overlap_pct: 0.1,
        a: baseArticle({ article_id: 1, impressions: 5000, avg_position: 3 }),
        b: baseArticle({ article_id: 2, impressions: 3000, avg_position: 25 }),
      }),
    );
    expect(r.action).toBe('DIFFERENTIATE');
    expect(r.rationale.factors).toContain('position_gap_serp_split');
  });

  it('Q1 fail 3: brand diversity gap >= 5 → DIFFERENTIATE', () => {
    const r = decidePair(
      basePair({
        cosine_similarity: 0.92,
        a: baseArticle({ article_id: 1, unique_brands_count: 12 }),
        b: baseArticle({ article_id: 2, unique_brands_count: 2 }),
      }),
    );
    expect(r.action).toBe('DIFFERENTIATE');
    expect(r.rationale.factors).toContain('brand_diversity_gap');
  });

  it('Q3 stage 1: kw_jaccard 0 + same_cell + serp_overlap >= 0.5 → CONSOLIDATE', () => {
    const r = decidePair(
      basePair({
        cosine_similarity: 0.97,
        kw_jaccard: 0.02,
        serp_overlap_pct: 0.6,
        a: baseArticle({ article_id: 1, impressions: 5000 }),
        b: baseArticle({ article_id: 2, impressions: 3000 }),
      }),
    );
    expect(r.action).toBe('CONSOLIDATE');
    expect(r.rationale.factors).toContain('kw_diverged_but_serp_aligned');
  });

  it('Q3 stage 3: kw_jaccard 0 + same_cell + serp 0.3 → KEEP (manual review)', () => {
    const r = decidePair(
      basePair({
        cosine_similarity: 0.91,
        kw_jaccard: 0.02,
        serp_overlap_pct: 0.3,
        a: baseArticle({ article_id: 1, impressions: 5000 }),
        b: baseArticle({ article_id: 2, impressions: 3000 }),
      }),
    );
    expect(r.action).toBe('KEEP');
    expect(r.rationale.factors).toContain('manual_review');
  });

  it('Q2 winner: high internal_links_in flips winner', () => {
    const a = baseArticle({ article_id: 1, clicks: 30, impressions: 1500, internal_links_in: 50 });
    const b = baseArticle({ article_id: 2, clicks: 50, impressions: 3000, internal_links_in: 5 });
    const r = decidePair(basePair({ cosine_similarity: 0.97, kw_jaccard: 0.3, kw_overlap_count: 5, a, b }));
    expect(r.action).toBe('CONSOLIDATE');
    // a が internal_links_in 50, b が 5 → 重み 0.22 で a が勝つ
    expect(r.target_article_id).toBe(1);
  });

  it('quarantined article in pair → KEEP (skip)', () => {
    const r = decidePair(
      basePair({
        a: baseArticle({ category_quarantine: 'confirmed' }),
      }),
    );
    expect(r.action).toBe('KEEP');
  });
});
