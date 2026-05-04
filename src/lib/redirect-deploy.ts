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
