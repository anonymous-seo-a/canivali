import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { applySqlFile, closeDb, getDb } from '../lib/db.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

const SCHEMA_PATH = 'db/schema.sql';
const SEEDS_DIR = 'db/seeds';

function applySchema(): void {
  const db = getDb();
  applySqlFile(db, SCHEMA_PATH);
  logger.info('schema applied');
}

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
    console.log('usage: seed.ts [--reset] [--create] [--seed-all]');
    process.exit(1);
  }

  if (args.has('--reset')) reset();
  if (args.has('--create') || args.has('--seed-all')) applySchema();
  if (args.has('--seed-all')) applySeeds();

  closeDb();
  logger.info('seed CLI done');
}

main();
