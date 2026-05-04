/**
 * loser → winner の 301 リダイレクトを Xserver の /no1/.htaccess に書き込む。
 *
 * 戦略:
 *   - 我々の管理ブロックは `# BEGIN canivali` ... `# END canivali` で囲む
 *   - 既存の他ルールは絶対に触らない
 *   - 書き込み前にバックアップを作る (.htaccess.bak.<timestamp>)
 *   - 書き込み後 nginx/Apache reload は不要 (.htaccess は per-request 評価)
 *
 * 実行:
 *   - findPostByUrl で loser slug を確認 (オプション)
 *   - SSH で .htaccess を取得 → 既存 canivali ブロック差し替え → put back
 */
import { spawn } from 'node:child_process';
import type Database from 'better-sqlite3';
import { env } from './env.js';

const HTACCESS_REMOTE = 'soico.jp/public_html/no1/.htaccess';
const SSH_TARGET = 'xserver-soico';
const BEGIN_MARKER = '# BEGIN canivali (auto-generated, do not edit between markers)';
const END_MARKER = '# END canivali';

export type RedirectRule = {
  loser_id: number;
  loser_url: string;
  winner_id: number;
  winner_url: string;
};

/**
 * URL から /no1/ 配下の slug 部分を抜き出す。
 *   https://www.soico.jp/no1/news/cardloan/11077  → news/cardloan/11077
 *   https://www.soico.jp/no1/news/cardloan/11077/ → news/cardloan/11077
 */
function urlToNo1Slug(url: string): string | null {
  const m = url.match(/^https?:\/\/[^/]+\/no1\/(.+?)\/?$/);
  return m && m[1] ? m[1] : null;
}

export function buildHtaccessBlock(rules: RedirectRule[]): string {
  const lines: string[] = [];
  lines.push(BEGIN_MARKER);
  lines.push(`# generated at ${new Date().toISOString()}, ${rules.length} rules`);
  lines.push('<IfModule mod_rewrite.c>');
  lines.push('RewriteEngine On');
  for (const r of rules) {
    const fromSlug = urlToNo1Slug(r.loser_url);
    if (!fromSlug) continue;
    const escaped = fromSlug.replace(/[.\-]/g, '\\$&');
    lines.push(
      `RewriteRule ^${escaped}/?$ ${r.winner_url} [R=301,L,QSA]  # canivali ${r.loser_id} → ${r.winner_id}`,
    );
  }
  lines.push('</IfModule>');
  lines.push(END_MARKER);
  return lines.join('\n');
}

/**
 * チェーン (A→B→C) を畳み、循環 (A→B→C→A) を破る。
 *
 * 入力: loser→winner の生のリダイレクト集合
 * 出力: loser→canonical の集合 (チェーンは終端まで畳む、循環は最高 traffic を canonical に)
 *
 * 戦略:
 *   1. グラフ構築 (each loser has 1 winner)
 *   2. 各ノードについて winner を辿り、終端 (= 自身が誰の winner にもなっていない) を canonical に
 *   3. 循環検出: 訪問済みに戻ったら循環。循環内の最高 traffic ノードを canonical にし、
 *      他は canonical に向ける
 */
export type ChainResolution = {
  resolved: RedirectRule[];          // 最終 loser → canonical
  chains: Array<{ from: number; via: number[]; to: number }>;  // 2段以上のチェーン
  cycles: number[][];                // 循環したノード集合
};

export function resolveChains(
  rules: RedirectRule[],
  trafficScore: (id: number) => number,
  urlOf: (id: number) => string | undefined,
): ChainResolution {
  const winnerOf = new Map<number, RedirectRule>();
  for (const r of rules) winnerOf.set(r.loser_id, r);

  const cycles: number[][] = [];
  const chains: Array<{ from: number; via: number[]; to: number }> = [];
  const finalDest = new Map<number, number>();

  for (const start of winnerOf.keys()) {
    if (finalDest.has(start)) continue;
    const visited = new Set<number>();
    let cur = start;
    const path: number[] = [start];
    while (winnerOf.has(cur)) {
      const next = winnerOf.get(cur)!.winner_id;
      if (visited.has(cur) || cur === next) break;
      if (path.includes(next)) {
        // cycle
        const idx = path.indexOf(next);
        const cycle = path.slice(idx);
        cycles.push(cycle);
        // canonical = traffic max
        let canon = cycle[0]!;
        let canonScore = trafficScore(canon);
        for (const n of cycle) {
          const s = trafficScore(n);
          if (s > canonScore) {
            canon = n;
            canonScore = s;
          }
        }
        for (const n of cycle) {
          if (n !== canon) finalDest.set(n, canon);
          else finalDest.set(n, n); // canonical points to self (skip in output)
        }
        // 入口ノード (start to cycle[0]) も canon へ
        for (const n of path.slice(0, idx)) finalDest.set(n, canon);
        break;
      }
      visited.add(cur);
      path.push(next);
      cur = next;
    }
    if (!finalDest.has(start)) {
      finalDest.set(start, cur);
      if (path.length > 2) chains.push({ from: start, via: path.slice(1, -1), to: cur });
    }
    // 中間ノードもキャッシュ
    for (let i = 1; i < path.length - 1; i++) {
      const n = path[i]!;
      if (!finalDest.has(n)) finalDest.set(n, cur);
    }
  }

  const resolved: RedirectRule[] = [];
  for (const [from, to] of finalDest) {
    if (from === to) continue;
    const url = urlOf(to);
    if (!url) continue;
    const orig = winnerOf.get(from);
    resolved.push({
      loser_id: from,
      loser_url: orig?.loser_url ?? '',
      winner_id: to,
      winner_url: url,
    });
  }
  return { resolved, chains, cycles };
}

export function loadApprovedRedirects(
  db: Database.Database,
  mode: 'approved' | 'auto' | 'all',
): RedirectRule[] {
  const filter =
    mode === 'auto'
      ? "dl.action='CONSOLIDATE' AND dl.confidence_score >= 0.85 AND (dl.human_reviewed = 0 OR (dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')))"
      : mode === 'all'
        ? "dl.action='CONSOLIDATE' AND (dl.human_reviewed = 0 OR (dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')))"
        : "dl.action='CONSOLIDATE' AND dl.human_reviewed = 1 AND (dl.human_decision IS NULL OR dl.human_decision != 'REJECTED')";

  const rows = db
    .prepare(
      `SELECT
         CASE WHEN cp.winner_article_id = cp.article_a_id THEN cp.article_b_id ELSE cp.article_a_id END AS loser_id,
         CASE WHEN cp.winner_article_id = cp.article_a_id THEN b.url ELSE a.url END AS loser_url,
         cp.winner_article_id AS winner_id,
         wa.url AS winner_url,
         dl.confidence_score AS conf
       FROM decision_log dl
       JOIN cannibalization_pairs cp ON cp.pair_id = dl.pair_id
       JOIN master_articles a ON a.article_id = cp.article_a_id
       JOIN master_articles b ON b.article_id = cp.article_b_id
       JOIN master_articles wa ON wa.article_id = cp.winner_article_id
       WHERE ${filter}
       ORDER BY dl.confidence_score DESC`,
    )
    .all() as Array<{ loser_id: number; loser_url: string; winner_id: number; winner_url: string; conf: number }>;

  // 同じ loser が複数 winner にまとめられる場合、最高 confidence のみ
  const byLoser = new Map<number, RedirectRule & { conf: number }>();
  for (const r of rows) {
    const cur = byLoser.get(r.loser_id);
    if (!cur || r.conf > cur.conf) byLoser.set(r.loser_id, r);
  }
  return [...byLoser.values()].map(({ conf, ...rest }) => rest);
}

function ssh(args: string[], opts?: { input?: string }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const sshArgs = ['-i', env.XSERVER_KEY_PATH ?? `${process.env.HOME}/.ssh/xserver_soico`, ...args];
    const c = spawn('ssh', sshArgs);
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout += d.toString()));
    c.stderr.on('data', (d) => (stderr += d.toString()));
    if (opts?.input) c.stdin.write(opts.input);
    c.stdin.end();
    c.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

/**
 * 現在の .htaccess を取得 → canivali ブロックを置換 → 書き戻す。
 * - 既存ルールは保持
 * - 書き込み前にバックアップを取る
 */
export async function deployRedirects(rules: RedirectRule[]): Promise<{ rules: number; backup: string }> {
  const get = await ssh([SSH_TARGET, `cat ${HTACCESS_REMOTE}`]);
  if (get.code !== 0) {
    throw new Error(`htaccess fetch failed: ${get.stderr}`);
  }
  const original = get.stdout;
  const newBlock = buildHtaccessBlock(rules);

  let next: string;
  const begin = original.indexOf(BEGIN_MARKER);
  if (begin === -1) {
    // 末尾に追加
    next = `${original.replace(/\s+$/, '')}\n\n${newBlock}\n`;
  } else {
    const end = original.indexOf(END_MARKER, begin);
    if (end === -1) throw new Error('found BEGIN canivali but no END marker');
    const before = original.slice(0, begin);
    const after = original.slice(end + END_MARKER.length);
    next = `${before}${newBlock}${after}`;
  }

  // バックアップ + 書き込み
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${HTACCESS_REMOTE}.bak.${ts}`;
  const put = await ssh(
    [SSH_TARGET, `cp ${HTACCESS_REMOTE} ${backup} && cat > ${HTACCESS_REMOTE}`],
    { input: next },
  );
  if (put.code !== 0) {
    throw new Error(`htaccess write failed: ${put.stderr}`);
  }
  return { rules: rules.length, backup };
}

/**
 * 1ペアだけ動作確認用に curl で 301 が返るか確かめる。
 */
export async function verifyRedirect(loserUrl: string, expectedWinnerUrl: string): Promise<{ ok: boolean; status: number; location: string | null }> {
  return new Promise((resolve) => {
    const c = spawn('curl', ['-sIo', '/dev/null', '-w', '%{http_code}|%{redirect_url}', loserUrl]);
    let buf = '';
    c.stdout.on('data', (d) => (buf += d.toString()));
    c.on('close', () => {
      const [code, location] = buf.split('|');
      const status = Number(code);
      resolve({
        ok: status === 301 && (location ?? '').startsWith(expectedWinnerUrl),
        status,
        location: location || null,
      });
    });
  });
}
