/**
 * Pilot セル D1×V1 (handoff §6.4) の 6 記事に対して Decision Engine の判定を出し、
 * Strategic Layer の予測 (handoff doc §6.4) と突合した精度レポートを生成する。
 *
 * 出力: docs/reports/pilot_d1v1_eval.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closeDb, getDb } from '../lib/db.js';

// handoff doc §6.4 の予測
const PREDICTIONS: Record<number, { expected: string; rationale: string }> = {
  11077: { expected: 'KEEP',          rationale: 'GSC 実績で確定。D1 主軸として残す' },
  13149: { expected: 'CONSOLIDATE',   rationale: '11077 とタイトル意図ほぼ同一、強カニバリ確定' },
  13673: { expected: 'DIFFERENTIATE', rationale: '選び方軸に純化 or 11077 統合' },
  13595: { expected: 'SPLIT',         rationale: 'E1 部分と D1 部分を分離' },
  22416: { expected: 'DIFFERENTIATE', rationale: 'E4 専門化、おすすめ要素削除' },
  13032: { expected: 'REASSIGN',      rationale: 'D2 (即日×低金利) に metadata 移動' },
};

const PILOT_IDS = Object.keys(PREDICTIONS).map(Number);

function fetchArticleDecisions(db: ReturnType<typeof getDb>) {
  const rows = db
    .prepare(
      `SELECT a.article_id, a.title,
              a.subtopic_topic_id, a.vocabulary_topic_id,
              a.business_relevance_score,
              dl.action AS engine_action,
              dl.confidence_score
         FROM master_articles a
    LEFT JOIN decision_log dl ON dl.article_id = a.article_id AND dl.pair_id IS NULL AND dl.human_reviewed = 0
        WHERE a.article_id IN (${PILOT_IDS.join(',')})`,
    )
    .all() as Array<{
    article_id: number;
    title: string;
    subtopic_topic_id: string | null;
    vocabulary_topic_id: string | null;
    business_relevance_score: number | null;
    engine_action: string | null;
    confidence_score: number | null;
  }>;
  return rows;
}

function fetchPairsAmongPilot(db: ReturnType<typeof getDb>) {
  const ids = PILOT_IDS.join(',');
  return db
    .prepare(
      `SELECT cp.pair_id, cp.article_a_id, cp.article_b_id,
              cp.cosine_similarity, cp.serp_overlap_pct, cp.shared_queries_count,
              cp.pair_relation, cp.severity, cp.winner_article_id,
              dl.action AS engine_action, dl.confidence_score, dl.target_url
         FROM cannibalization_pairs cp
    LEFT JOIN decision_log dl ON dl.pair_id = cp.pair_id AND dl.human_reviewed = 0
        WHERE cp.article_a_id IN (${ids})
          AND cp.article_b_id IN (${ids})
        ORDER BY cp.cosine_similarity DESC`,
    )
    .all() as Array<{
    pair_id: number;
    article_a_id: number;
    article_b_id: number;
    cosine_similarity: number;
    serp_overlap_pct: number | null;
    shared_queries_count: number | null;
    pair_relation: string | null;
    severity: string;
    winner_article_id: number | null;
    engine_action: string | null;
    confidence_score: number | null;
    target_url: string | null;
  }>;
}

function buildReport(): string {
  const db = getDb();
  const articles = fetchArticleDecisions(db);
  const pairs = fetchPairsAmongPilot(db);
  closeDb();

  const lines: string[] = [];
  lines.push('# Pilot D1×V1 — Decision Engine Evaluation', '');
  lines.push(
    '本レポートは Phase 0 handoff §6.4 の予測判定と Phase 3 Decision Engine の出力を突合する。',
  );
  lines.push('');

  // 単独記事レベルの突合
  lines.push('## 1. 単独記事評価');
  lines.push('');
  lines.push('| ID | 予測 | engine | 一致 | confidence | subtopic | V | relevance |');
  lines.push('|----|------|--------|------|-----------|----------|---|-----------|');

  let matchCount = 0;
  for (const id of PILOT_IDS) {
    const a = articles.find((x) => x.article_id === id);
    const pred = PREDICTIONS[id];
    if (!a || !pred) {
      lines.push(`| ${id} | ${pred?.expected ?? '?'} | (missing) | ❌ | — | — | — | — |`);
      continue;
    }
    const match = a.engine_action === pred.expected;
    if (match) matchCount++;
    lines.push(
      `| ${id} | ${pred.expected} | ${a.engine_action ?? '—'} | ${match ? '✅' : '❌'} | ${a.confidence_score?.toFixed(2) ?? '—'} | ${a.subtopic_topic_id ?? '—'} | ${a.vocabulary_topic_id ?? '—'} | ${a.business_relevance_score?.toFixed(3) ?? '—'} |`,
    );
  }
  lines.push('');
  lines.push(`**単独記事の予測一致率**: ${matchCount}/${PILOT_IDS.length} (${((matchCount / PILOT_IDS.length) * 100).toFixed(0)}%)`);
  lines.push('');
  lines.push('注: 単独記事レベルでは engine は KEEP/REASSIGN/DELETE しか出さない設計のため、CONSOLIDATE/DIFFERENTIATE/SPLIT はペア評価で検出される。');
  lines.push('');

  // ペアレベルの評価
  lines.push('## 2. Pilot 6 記事間のペア判定');
  lines.push('');
  if (pairs.length === 0) {
    lines.push('Pilot 内ペアが cannibalization_pairs に存在しない (cosine < 0.8)。');
  } else {
    lines.push('| pair | a→b | cosine | serp_overlap | rel | engine | conf | winner | target |');
    lines.push('|------|-----|--------|--------------|-----|--------|------|--------|--------|');
    for (const p of pairs) {
      const winner = p.winner_article_id ?? '';
      lines.push(
        `| ${p.pair_id} | ${p.article_a_id} → ${p.article_b_id} | ${p.cosine_similarity.toFixed(3)} | ${p.serp_overlap_pct?.toFixed(2) ?? '—'} | ${p.pair_relation ?? '—'} | ${p.engine_action ?? '—'} | ${p.confidence_score?.toFixed(2) ?? '—'} | ${winner} | ${p.target_url ? p.target_url.split('/').pop() : '—'} |`,
      );
    }
  }
  lines.push('');

  // ハンドオフの予測判定との突合 (CONSOLIDATE/DIFFERENTIATE/SPLIT)
  lines.push('## 3. 解釈');
  lines.push('');
  lines.push('### 予測通り出るべきもの');
  lines.push('- **13149 → 11077 CONSOLIDATE**: handoff §6.4 強カニバリ確定。pair で 11077↔13149 が CONSOLIDATE & winner=11077 か?');
  lines.push('- **13673 DIFFERENTIATE**: 「選び方」軸に純化。同 D1×V1 セルなのでペア判定が鍵。');
  lines.push('- **22416 DIFFERENTIATE**: メリット・デメリット軸 = E4 ハイブリッド扱い。');
  lines.push('- **13032 REASSIGN to D2**: D2 (B1 即日 × 低金利) のピラーへ。subtopic 仮割当が D1 になっている可能性が高く REASSIGN 候補に出るはず。');
  lines.push('');
  lines.push('### Engine 限界');
  lines.push('- **13595 SPLIT**: 現状の engine は SPLIT を出さない (Phase 3 拡張)。');
  lines.push('- **REASSIGN の target** (どこへ): engine は move 先を決めない (Phase 3 拡張、embedding centroid との距離で決定)。');
  lines.push('');

  return lines.join('\n');
}

function main() {
  const md = buildReport();
  const outDir = resolve('docs/reports');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'pilot_d1v1_eval.md');
  writeFileSync(outPath, md, 'utf8');
  console.log(`✓ wrote ${outPath}`);
  console.log('---');
  console.log(md);
}

main();
