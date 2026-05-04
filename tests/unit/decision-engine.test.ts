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
  a: baseArticle({ article_id: 1, clicks: 1000, impressions: 5000 }),
  b: baseArticle({ article_id: 2, clicks: 100, impressions: 500 }),
  ...overrides,
});

describe('decidePair', () => {
  it('same_cell + cosine ≥ 0.95 → CONSOLIDATE high confidence', () => {
    const r = decidePair(basePair({ cosine_similarity: 0.97 }));
    expect(r.action).toBe('CONSOLIDATE');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.target_article_id).toBe(1); // higher clicks wins
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

  it('quarantined article in pair → KEEP (skip)', () => {
    const r = decidePair(
      basePair({
        a: baseArticle({ category_quarantine: 'confirmed' }),
      }),
    );
    expect(r.action).toBe('KEEP');
  });
});
