import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DB_PATH: z.string().default('./db/cannibalization.db'),

  SOICO_BASE_URL: z.string().url().default('https://www.soico.jp'),
  SOICO_CARDLOAN_PATH: z.string().default('/no1/news/cardloan'),
  USER_AGENT_FOR_CRAWL: z.string().default(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ),

  XSERVER_HOST: z.string().optional(),
  XSERVER_PORT: z.string().optional(),
  XSERVER_USER: z.string().optional(),
  XSERVER_KEY_PATH: z.string().optional(),

  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GSC_PROPERTY_URL: z.string().optional(),
  GA4_PROPERTY_ID: z.string().optional(),
  CLARITY_PROJECT_ID: z.string().optional(),
  CLARITY_API_TOKEN: z.string().optional(),

  SERPAPI_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  PORT: z.coerce.number().default(4040),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  CRAWL_CONCURRENCY: z.coerce.number().default(3),
  CRAWL_DELAY_MS: z.coerce.number().default(2000),
  CRAWL_TIMEOUT_MS: z.coerce.number().default(30_000),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export const env = loadEnv();
