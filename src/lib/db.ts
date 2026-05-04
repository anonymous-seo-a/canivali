import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from './env.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = resolve(env.DB_PATH);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function applySqlFile(db: Database.Database, sqlPath: string): void {
  const sql = readFileSync(resolve(sqlPath), 'utf8');
  db.exec(sql);
}

export function recordAudit(
  db: Database.Database,
  args: {
    entityType: string;
    entityId: string;
    action: 'create' | 'update' | 'delete' | 'execute';
    before?: unknown;
    after?: unknown;
    actor: string;
    reason?: string;
  },
): void {
  db.prepare(
    `INSERT INTO master_audit_log
       (entity_type, entity_id, action, before_state_json, after_state_json, actor, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.entityType,
    args.entityId,
    args.action,
    args.before ? JSON.stringify(args.before) : null,
    args.after ? JSON.stringify(args.after) : null,
    args.actor,
    args.reason ?? null,
  );
}
