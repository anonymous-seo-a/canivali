/**
 * WordPress REST API クライアント。
 *
 * 認証: Application Password (Basic Auth)
 * https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/#application-passwords
 *
 * Phase 3 統合実行で:
 *   - loser 記事を draft に変更 (status=draft) → 公開停止
 *   - winner_url への 301 リダイレクトは別途プラグインや .htaccess で扱う想定
 *     (post meta `_canivali_consolidated_to` を埋めて、サイト側で対応)
 */
import { fetch } from 'undici';
import { env } from './env.js';

export type WpPostSummary = {
  id: number;
  status: string;
  link: string;
  title: { rendered: string };
  modified: string;
};

function authHeader(): string {
  if (!env.WP_USERNAME || !env.WP_APP_PASSWORD) {
    throw new Error('WP_USERNAME / WP_APP_PASSWORD is not set');
  }
  // Application Password はスペースが含まれて表示されるが、認証時はそのまま使う
  const token = Buffer.from(`${env.WP_USERNAME}:${env.WP_APP_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

function apiUrl(path: string): string {
  if (!env.WP_API_BASE) throw new Error('WP_API_BASE is not set');
  // Cloudflare が認証必要なレスポンスもキャッシュするので nocache パラメータを毎回付ける
  const sep = path.includes('?') ? '&' : '?';
  return `${env.WP_API_BASE.replace(/\/+$/, '')}${path}${sep}_t=${Date.now()}`;
}

const WP_HEADERS_AUTH = (): Record<string, string> => ({
  Authorization: authHeader(),
  'Cache-Control': 'no-cache',
});

/**
 * URL から post id を逆引きする。slug ベースで検索。
 *   /no1/news/cardloan/11077  → slug="11077" or "cardloan-11077" 想定。
 *   実体は WP の URL 構造により異なるので、まず URL の末尾セグメントを slug として試す。
 */
export async function findPostByUrl(url: string): Promise<WpPostSummary | null> {
  const m = url.match(/\/(\d+)\/?$/);
  if (!m || !m[1]) return null;
  const slug = m[1];
  const res = await fetch(apiUrl(`/posts?slug=${encodeURIComponent(slug)}&_fields=id,status,link,title,modified&per_page=5`), {
    headers: WP_HEADERS_AUTH(),
  });
  if (!res.ok) {
    throw new Error(`WP findPost ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const arr = (await res.json()) as WpPostSummary[];
  // 完全一致 (URL でフィルタ) を優先
  const exact = arr.find((p) => p.link === url || p.link === `${url}/` || `${p.link}/` === url);
  return exact ?? arr[0] ?? null;
}

export async function getPost(postId: number): Promise<WpPostSummary | null> {
  const res = await fetch(apiUrl(`/posts/${postId}?_fields=id,status,link,title,modified`), {
    headers: WP_HEADERS_AUTH(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`WP getPost ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()) as WpPostSummary;
}

/**
 * Loser 記事を draft 化 + redirect 先の post meta を保存。
 *   - status='draft' で公開停止 (URL は 404 になるので redirect 仕掛けが別途必要)
 *   - meta._canivali_consolidated_to=<winner_url> を保存
 */
export async function consolidateLoser(args: {
  loserPostId: number;
  winnerUrl: string;
  reason?: string;
}): Promise<WpPostSummary> {
  const body = {
    status: 'draft',
    meta: {
      _canivali_consolidated_to: args.winnerUrl,
      _canivali_consolidated_at: new Date().toISOString(),
      _canivali_consolidated_reason: args.reason ?? '',
    },
  };
  const res = await fetch(apiUrl(`/posts/${args.loserPostId}`), {
    method: 'POST',
    headers: { ...WP_HEADERS_AUTH(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`WP consolidate ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as WpPostSummary;
}

/**
 * 完全削除 (trash 行き)。Phase 3 では使わず draft 化が安全。
 */
export async function trashPost(postId: number): Promise<void> {
  const res = await fetch(apiUrl(`/posts/${postId}`), {
    method: 'DELETE',
    headers: WP_HEADERS_AUTH(),
  });
  if (!res.ok) {
    throw new Error(`WP trash ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

export async function ping(): Promise<{ ok: boolean; user?: string; error?: string }> {
  try {
    if (!env.WP_API_BASE || !env.WP_USERNAME || !env.WP_APP_PASSWORD) {
      return { ok: false, error: 'WP_* env not fully set' };
    }
    const res = await fetch(apiUrl('/users/me'), {
      headers: WP_HEADERS_AUTH(),
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${await res.text().catch(() => '')}` };
    const u = (await res.json()) as { name?: string; slug?: string };
    return { ok: true, user: u.name ?? u.slug };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
