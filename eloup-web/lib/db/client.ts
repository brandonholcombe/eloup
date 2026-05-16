import Database from 'better-sqlite3';
import { env } from '@/lib/env';
import { applyMigrations } from '@/lib/db/migrate';

let cached: Database.Database | null = null;

export function db(): Database.Database {
  if (cached) return cached;
  const handle = new Database(env().DATABASE_PATH);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');
  applyMigrations(handle);
  cached = handle;
  return cached;
}

// For tests that need a fresh, isolated database.
export function openTestDb(path: string): Database.Database {
  const handle = new Database(path);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');
  applyMigrations(handle);
  return handle;
}
