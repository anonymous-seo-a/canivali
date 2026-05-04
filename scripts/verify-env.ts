/**
 * 全外部APIへの認証確認 (最小コスト)。
 * Phase 1 では「叩けるか」を確認するだけで実データ取得は Phase 2 以降。
 *
 * 環境変数が未設定のキーは SKIP として扱う (FAIL ではない)。
 */
import { google } from 'googleapis';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { fetch } from 'undici';
import { getClaude, CLAUDE_DEFAULT_MODEL } from '../src/lib/claude.js';
import { getOpenAI, EMBEDDING_MODEL } from '../src/lib/openai.js';
import { embed, VOYAGE_MODEL } from '../src/lib/voyage.js';
import { env } from '../src/lib/env.js';

type Status = '✅' | '⏭️ ' | '❌';

const results: Array<{ name: string; status: Status; detail: string }> = [];

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail });
  console.log(`${status} ${name.padEnd(10)} — ${detail}`);
}

async function checkGSC(): Promise<void> {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS || !env.GSC_PROPERTY_URL) {
    record('GSC', '⏭️ ', 'env unset');
    return;
  }
  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const wm = google.webmasters({ version: 'v3', auth });
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 7);
    const end = new Date(today);
    end.setDate(today.getDate() - 3); // GSC has ~2-3 day delay
    const res = await wm.searchanalytics.query({
      siteUrl: env.GSC_PROPERTY_URL,
      requestBody: {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ['query'],
        rowLimit: 1,
      },
    });
    record('GSC', '✅', `auth ok, ${res.data.rows?.length ?? 0} row(s) sampled`);
  } catch (e) {
    record('GSC', '❌', e instanceof Error ? e.message : String(e));
  }
}

async function checkGA4(): Promise<void> {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS || !env.GA4_PROPERTY_ID) {
    record('GA4', '⏭️ ', 'env unset');
    return;
  }
  try {
    const client = new BetaAnalyticsDataClient();
    const [resp] = await client.runReport({
      property: `properties/${env.GA4_PROPERTY_ID}`,
      dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
      metrics: [{ name: 'sessions' }],
      limit: 1,
    });
    record('GA4', '✅', `auth ok, ${resp.rowCount ?? 0} row(s)`);
  } catch (e) {
    record('GA4', '❌', e instanceof Error ? e.message : String(e));
  }
}

async function checkClarity(): Promise<void> {
  if (!env.CLARITY_API_TOKEN || !env.CLARITY_PROJECT_ID) {
    record('Clarity', '⏭️ ', 'env unset');
    return;
  }
  try {
    const res = await fetch(
      `https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1`,
      { headers: { Authorization: `Bearer ${env.CLARITY_API_TOKEN}` } },
    );
    if (!res.ok) {
      record('Clarity', '❌', `http ${res.status}`);
      return;
    }
    record('Clarity', '✅', `http ${res.status}`);
  } catch (e) {
    record('Clarity', '❌', e instanceof Error ? e.message : String(e));
  }
}

async function checkSerpAPI(): Promise<void> {
  if (!env.SERPAPI_KEY) {
    record('SerpAPI', '⏭️ ', 'env unset');
    return;
  }
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('q', 'カードローン');
    url.searchParams.set('hl', 'ja');
    url.searchParams.set('gl', 'jp');
    url.searchParams.set('api_key', env.SERPAPI_KEY);
    const res = await fetch(url);
    if (!res.ok) {
      record('SerpAPI', '❌', `http ${res.status}`);
      return;
    }
    record('SerpAPI', '✅', `http ${res.status}`);
  } catch (e) {
    record('SerpAPI', '❌', e instanceof Error ? e.message : String(e));
  }
}

async function checkClaude(): Promise<void> {
  if (!env.ANTHROPIC_API_KEY) {
    record('Claude', '⏭️ ', 'env unset');
    return;
  }
  try {
    const c = getClaude();
    const r = await c.messages.create({
      model: CLAUDE_DEFAULT_MODEL,
      max_tokens: 4,
      messages: [{ role: 'user', content: 'ping' }],
    });
    record('Claude', '✅', `model=${r.model}`);
  } catch (e) {
    record('Claude', '❌', e instanceof Error ? e.message : String(e));
  }
}

async function checkOpenAI(): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    record('OpenAI', '⏭️ ', 'env unset');
    return;
  }
  try {
    const c = getOpenAI();
    const r = await c.embeddings.create({
      model: EMBEDDING_MODEL,
      input: 'ping',
    });
    record('OpenAI', '✅', `model=${EMBEDDING_MODEL}, dim=${r.data[0]?.embedding.length ?? 0}`);
  } catch (e) {
    record('OpenAI', '❌', e instanceof Error ? e.message : String(e));
  }
}

async function checkVoyage(): Promise<void> {
  if (!env.VOYAGE_API_KEY) {
    record('Voyage', '⏭️ ', 'env unset');
    return;
  }
  try {
    const r = await embed(['ping']);
    record('Voyage', '✅', `model=${VOYAGE_MODEL}, dim=${r.embeddings[0]?.length ?? 0}`);
  } catch (e) {
    record('Voyage', '❌', e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  console.log('=== verify-env ===');
  await checkGSC();
  await checkGA4();
  await checkClarity();
  await checkSerpAPI();
  await checkClaude();
  await checkOpenAI();
  await checkVoyage();

  const failed = results.filter((r) => r.status === '❌').length;
  const skipped = results.filter((r) => r.status === '⏭️ ').length;
  const ok = results.filter((r) => r.status === '✅').length;
  console.log(`\nsummary: ok=${ok} skipped=${skipped} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
