/**
 * SPLIT 候補検出。
 *
 * フロー:
 *   1. 各 in_scope 記事の embedding と全 subtopic centroid との cosine を計算
 *   2. 上位 1 と上位 2 の score 差 (margin) が小さい記事 = 「複数 subtopic に跨る」候補
 *   3. 上位 N (default 30) について Claude API に本文を投げ、
 *      「この記事は subtopic A と B が混ざっているか?」を判定
 *   4. 「分割推奨」なら decision_log に action='SPLIT' で保存
 *
 * 使い方:
 *   npm run decide:split                  # 上位 30
 *   npm run decide:split -- --limit=50    # 上位 50
 *   npm run decide:split -- --dry-run     # Claude 呼ばずに候補一覧のみ
 */
import type Database from 'better-sqlite3';
import { CLAUDE_DEFAULT_MODEL, getClaude } from '../lib/claude.js';
import { closeDb, getDb, recordAudit } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { blobToVector, cosine } from '../lib/voyage.js';

const DEFAULT_LIMIT = 30;
const MAX_BODY_CHARS = 6_000;
const AMBIGUITY_MARGIN_MAX = 0.05; // top1 - top2 がこれ以下なら SPLIT 候補

type Topic = { topic_id: string; name: string; centroid: Float32Array };

function loadSubtopicCentroids(db: Database.Database): Topic[] {
  const rows = db
    .prepare(
      `SELECT topic_id, name, centroid_vector
         FROM master_topics
        WHERE topic_kind = 'subtopic_minor' AND centroid_vector IS NOT NULL`,
    )
    .all() as Array<{ topic_id: string; name: string; centroid_vector: Buffer }>;
  return rows.map((r) => ({
    topic_id: r.topic_id,
    name: r.name,
    centroid: blobToVector(r.centroid_vector),
  }));
}

function topTwoSubtopics(vec: Float32Array, topics: Topic[]): { first: Topic; second: Topic; firstScore: number; secondScore: number } | null {
  let first: { topic: Topic; score: number } | null = null;
  let second: { topic: Topic; score: number } | null = null;
  for (const t of topics) {
    const c = cosine(vec, t.centroid);
    if (!first || c > first.score) {
      second = first;
      first = { topic: t, score: c };
    } else if (!second || c > second.score) {
      second = { topic: t, score: c };
    }
  }
  if (!first || !second) return null;
  return { first: first.topic, second: second.topic, firstScore: first.score, secondScore: second.score };
}

async function judgeWithClaude(args: {
  title: string;
  body: string;
  topic_a: { id: string; name: string };
  topic_b: { id: string; name: string };
}): Promise<{ split_recommended: boolean; rationale: string; section_a_excerpt?: string; section_b_excerpt?: string }> {
  const prompt = `あなたは soico カードローン領域の編集者です。
以下の記事は 2 つの subtopic にまたがる可能性があります:
- subtopic A (${args.topic_a.id}): ${args.topic_a.name}
- subtopic B (${args.topic_b.id}): ${args.topic_b.name}

記事タイトル: ${args.title}

記事本文 (抜粋):
${args.body}

判定タスク:
1. この記事が両方の subtopic を扱っているか? それとも片方が枝葉として軽く触れている程度か?
2. 真に「分割すべき」(両方に独立した記事を作るべき) なら split_recommended=true。
3. そうでなければ false。

JSON のみで答えてください。スキーマ:
{
  "split_recommended": true|false,
  "rationale": "判定の理由 (日本語、100字以内)",
  "section_a_excerpt": "subtopic A の代表的な本文断片 (200字以内、split_recommended=true のみ)",
  "section_b_excerpt": "subtopic B の代表的な本文断片 (200字以内、split_recommended=true のみ)"
}`;

  const c = getClaude();
  const r = await c.messages.create({
    model: CLAUDE_DEFAULT_MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });
  const txt = r.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Claude returned non-JSON: ${txt.slice(0, 200)}`);
  return JSON.parse(m[0]);
}

function parseArgs(argv: string[]): { limit: number; dryRun: boolean } {
  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  for (const a of argv) {
    if (a.startsWith('--limit=')) limit = Number(a.split('=')[1]);
    if (a === '--dry-run') dryRun = true;
  }
  return { limit, dryRun };
}

async function main() {
  const { limit, dryRun } = parseArgs(process.argv.slice(2));
  const db = getDb();
  const subtopics = loadSubtopicCentroids(db);
  logger.info({ subtopics: subtopics.length, limit, dryRun }, 'split-detect begin');

  const articles = db
    .prepare(
      `SELECT article_id, title, body_text, article_embedding
         FROM master_articles
        WHERE article_embedding IS NOT NULL
          AND category_quarantine != 'confirmed'
          AND body_text IS NOT NULL`,
    )
    .all() as Array<{ article_id: number; title: string; body_text: string; article_embedding: Buffer }>;

  // 全記事の (top1 - top2) margin を計算 → 小さい順に並べる
  const ranked: Array<{
    article_id: number;
    title: string;
    body: string;
    top1: Topic;
    top2: Topic;
    score1: number;
    score2: number;
    margin: number;
  }> = [];
  for (const a of articles) {
    const vec = blobToVector(a.article_embedding);
    const tops = topTwoSubtopics(vec, subtopics);
    if (!tops) continue;
    const margin = tops.firstScore - tops.secondScore;
    if (margin > AMBIGUITY_MARGIN_MAX) continue;
    ranked.push({
      article_id: a.article_id,
      title: a.title,
      body: a.body_text.slice(0, MAX_BODY_CHARS),
      top1: tops.first,
      top2: tops.second,
      score1: tops.firstScore,
      score2: tops.secondScore,
      margin,
    });
  }
  ranked.sort((a, b) => a.margin - b.margin);
  const candidates = ranked.slice(0, limit);

  console.log(`=== split candidates (margin <= ${AMBIGUITY_MARGIN_MAX}) ===`);
  console.log(`total ambiguous: ${ranked.length}, evaluating top ${candidates.length}`);

  if (dryRun) {
    for (const c of candidates) {
      console.log(
        `  margin=${c.margin.toFixed(3)}  [${c.article_id}] ${c.title.slice(0, 40)}  → ${c.top1.topic_id}(${c.top1.name}) vs ${c.top2.topic_id}(${c.top2.name})`,
      );
    }
    closeDb();
    return;
  }

  // 既存の SPLIT 判定を未承認分のみクリア
  db.prepare("DELETE FROM decision_log WHERE action='SPLIT' AND human_reviewed=0").run();

  const ins = db.prepare(
    `INSERT INTO decision_log
       (article_id, action, target_subtopic_id, target_vocabulary_id,
        confidence_score, rationale_json, human_reviewed)
     VALUES (?, 'SPLIT', ?, NULL, ?, ?, 0)`,
  );

  let split = 0;
  let nosplit = 0;
  let claudeErrors = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    try {
      const j = await judgeWithClaude({
        title: c.title,
        body: c.body,
        topic_a: { id: c.top1.topic_id, name: c.top1.name },
        topic_b: { id: c.top2.topic_id, name: c.top2.name },
      });
      if (j.split_recommended) {
        split++;
        ins.run(
          c.article_id,
          c.top2.topic_id, // 「分割先」候補として top2 を入れる (target_subtopic_id)
          0.7,
          JSON.stringify({
            factors: ['embedding_ambiguity', 'claude_split_judgment'],
            scores: {
              top1: c.top1.topic_id,
              top2: c.top2.topic_id,
              top1_score: round(c.score1),
              top2_score: round(c.score2),
              margin: round(c.margin),
            },
            rationale: j.rationale,
            section_a_excerpt: j.section_a_excerpt,
            section_b_excerpt: j.section_b_excerpt,
          }),
        );
        console.log(`  SPLIT  [${c.article_id}] ${c.title.slice(0, 40)} — ${j.rationale.slice(0, 60)}`);
      } else {
        nosplit++;
      }
      logger.info({ progress: `${i + 1}/${candidates.length}`, split, nosplit }, 'progress');
    } catch (e) {
      claudeErrors++;
      logger.warn({ id: c.article_id, err: e instanceof Error ? e.message : String(e) }, 'claude judgment error');
    }
  }

  console.log(`\nresult: split=${split}, nosplit=${nosplit}, errors=${claudeErrors}`);
  recordAudit(db, {
    entityType: 'decision_log',
    entityId: 'split_detect',
    action: 'create',
    after: { evaluated: candidates.length, split, nosplit, errors: claudeErrors },
    actor: 'cli:split-detect',
    reason: 'Phase 3 Step D',
  });

  closeDb();
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, 'fatal');
  process.exit(1);
});
