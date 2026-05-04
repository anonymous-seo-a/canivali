/**
 * Phase B: ペア独立判定の副作用を解消するグラフ正規化フェーズ。
 *
 * 入力: Phase A の decidePair 結果群 (各ペアごとに winner / action 等)
 * 処理:
 *   B1. ロール集計
 *   B2. Multi-target 解消 (1 loser → 複数 winner) → 最高 score の winner だけ採用、他は MANUAL_REVIEW
 *   B3. 役割衝突解消 (1 記事が loser かつ winner) → 優勢側を残し、劣勢側は MANUAL_REVIEW
 * 出力: 同じペア群 (action と reason が更新されている可能性あり)
 *
 * Note: B4 (チェーン圧縮) は redirect-deploy.ts の resolveChains が deploy 時に行う。
 *       Phase B 段階でやらない理由: ここでは判定の論理整合性に集中し、
 *       実際の URL 操作 (.htaccess) はデプロイ時に行うのが分離の原則。
 */

import type { Action } from './engine.js';

export type NormalizableDecision = {
  pair_id: number;
  article_a_id: number;
  article_b_id: number;
  winner_article_id: number | null;
  action: Action;
  confidence: number;
  rationale: { factors: string[]; scores: Record<string, number | string | boolean> };
  // B 出力用 (元の action を保持して降格根拠を記録)
  original_action?: Action;
  demoted_reason?: string;
};

// 全記事横断の絶対スコア (どの winner が「最も canonical らしいか」を決める)
// pair 内 normalize ではなく、絶対値ベース
export type AbsoluteScore = (articleId: number) => number;

export type NormalizeReport = {
  multiTargetDemoted: number;
  roleConflictDemoted: number;
  consolidateBefore: number;
  consolidateAfter: number;
  manualReview: number;
};

export function normalizeGraph(
  decisions: NormalizableDecision[],
  absoluteScore: AbsoluteScore,
): NormalizeReport {
  const report: NormalizeReport = {
    multiTargetDemoted: 0,
    roleConflictDemoted: 0,
    consolidateBefore: 0,
    consolidateAfter: 0,
    manualReview: 0,
  };

  // ============= B1: ロール集計 =============
  // 各記事について、それが loser になっているペア / winner になっているペアを索引化
  const loserOf = new Map<number, NormalizableDecision[]>();   // article_id → pairs (article is loser)
  const winnerOf = new Map<number, NormalizableDecision[]>();  // article_id → pairs (article is winner)

  for (const d of decisions) {
    if (d.action !== 'CONSOLIDATE') continue;
    if (!d.winner_article_id) continue;
    report.consolidateBefore++;
    const loserId =
      d.winner_article_id === d.article_a_id ? d.article_b_id : d.article_a_id;
    push(loserOf, loserId, d);
    push(winnerOf, d.winner_article_id, d);
  }

  // ============= B2: Multi-target 解消 =============
  // article X が loser になっているペアが複数あり、それぞれ別 winner に向かう場合、
  // 全 winner 候補のうち最高 absoluteScore のものだけ残す。
  for (const [loserId, pairs] of loserOf) {
    if (pairs.length <= 1) continue;
    // 異なる winner が複数か?
    const distinctWinners = new Set(pairs.map((p) => p.winner_article_id));
    if (distinctWinners.size <= 1) continue; // 同 winner への重複ペアは問題ない (pair_id 違いで入れたなら統合)

    // 最高 score の winner を選定
    let bestWinner: number | null = null;
    let bestScore = -Infinity;
    for (const w of distinctWinners) {
      if (w === null) continue;
      const s = absoluteScore(w);
      if (s > bestScore) {
        bestWinner = w;
        bestScore = s;
      }
    }

    // 最良 winner 以外のペアを MANUAL_REVIEW に降格
    for (const p of pairs) {
      if (p.winner_article_id !== bestWinner) {
        demote(p, 'MANUAL_REVIEW', 'multi_target_demoted', report);
        report.multiTargetDemoted++;
      }
    }
  }

  // 降格反映後にロール集計を再構築 (B3 のため)
  loserOf.clear();
  winnerOf.clear();
  for (const d of decisions) {
    if (d.action !== 'CONSOLIDATE') continue;
    if (!d.winner_article_id) continue;
    const loserId =
      d.winner_article_id === d.article_a_id ? d.article_b_id : d.article_a_id;
    push(loserOf, loserId, d);
    push(winnerOf, d.winner_article_id, d);
  }

  // ============= B3: 役割衝突解消 =============
  // 同一記事が loser でも winner でもある = 矛盾
  const allArticleIds = new Set<number>([...loserOf.keys(), ...winnerOf.keys()]);
  for (const aid of allArticleIds) {
    const asLoser = loserOf.get(aid) ?? [];
    const asWinner = winnerOf.get(aid) ?? [];
    if (asLoser.length === 0 || asWinner.length === 0) continue;

    // どちらが優勢か
    if (asLoser.length > asWinner.length) {
      // この記事は消える側 → winner ロールのペアを降格
      for (const p of asWinner) {
        demote(p, 'MANUAL_REVIEW', 'role_conflict_loser_dominant', report);
        report.roleConflictDemoted++;
      }
    } else if (asWinner.length > asLoser.length) {
      // この記事は残る側 → loser ロールのペアを降格
      for (const p of asLoser) {
        demote(p, 'MANUAL_REVIEW', 'role_conflict_winner_dominant', report);
        report.roleConflictDemoted++;
      }
    } else {
      // 同数 → 全部降格
      for (const p of [...asLoser, ...asWinner]) {
        demote(p, 'MANUAL_REVIEW', 'role_conflict_equal', report);
        report.roleConflictDemoted++;
      }
    }
  }

  // ============= 集計 =============
  for (const d of decisions) {
    if (d.action === 'CONSOLIDATE') report.consolidateAfter++;
    else if (d.action === 'MANUAL_REVIEW') report.manualReview++;
  }

  return report;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function demote(
  d: NormalizableDecision,
  to: Action,
  reason: string,
  _report: NormalizeReport,
): void {
  if (d.action === to) return; // 既に降格済み (重複は数えない)
  if (!d.original_action) d.original_action = d.action;
  d.action = to;
  d.demoted_reason = d.demoted_reason ? `${d.demoted_reason},${reason}` : reason;
  d.rationale.factors.push(`demoted:${reason}`);
}
