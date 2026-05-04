import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { applySqlFile, closeDb, getDb } from '../lib/db.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

const SCHEMA_PATH = 'db/schema.sql';
const SEEDS_DIR = 'db/seeds';
const MIGRATIONS_DIR = 'db/migrations';

function applySchema(): void {
  const db = getDb();
  applySqlFile(db, SCHEMA_PATH);
  logger.info('schema applied');
}

function applyMigrations(): void {
  const db = getDb();
  const dir = resolve(MIGRATIONS_DIR);
  if (!existsSync(dir)) return;
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version,
    ),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    // ファイル名 0002_phase2_embeddings.sql から version 0.2.0 を割り出すのは難しいので、
    // 各 migration が `INSERT OR IGNORE INTO schema_migrations` を末尾に書く前提で実行。
    // 二重実行は ALTER TABLE ADD COLUMN が失敗するので skip 判定が必要。
    // 簡易的に: 4桁プレフィックスから version を逆引きできる対応表を持つ。
    const version = MIGRATION_VERSIONS[f];
    if (version && applied.has(version)) {
      logger.info({ file: f, version }, 'migration already applied — skip');
      continue;
    }
    logger.info({ file: f }, 'applying migration');
    applySqlFile(db, resolve(dir, f));
  }
}

const MIGRATION_VERSIONS: Record<string, string> = {
  '0002_phase2_embeddings.sql': '0.2.0',
  '0003_phase3_decision.sql': '0.3.0',
  '0004_lift_tracking.sql': '0.4.0',
  '0005_kw_jaccard.sql': '0.5.0',
};

function applySeeds(): void {
  const db = getDb();
  const dir = resolve(SEEDS_DIR);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    logger.info({ file: f }, 'applying seed');
    applySqlFile(db, resolve(dir, f));
  }
  logger.info({ count: files.length }, 'seeds applied');
}

function reset(): void {
  const dbPath = resolve(env.DB_PATH);
  closeDb();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) {
      unlinkSync(p);
      logger.warn({ file: p }, 'removed');
    }
  }
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  if (args.size === 0) {
    console.log('usage: seed.ts [--reset] [--create] [--migrate] [--seed-all]');
    process.exit(1);
  }

  if (args.has('--reset')) reset();
  if (args.has('--create') || args.has('--seed-all')) applySchema();
  if (args.has('--migrate') || args.has('--seed-all')) applyMigrations();
  if (args.has('--seed-all')) applySeeds();

  closeDb();
  logger.info('seed CLI done');
}

main();
