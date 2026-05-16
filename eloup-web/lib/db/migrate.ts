import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

// Resolve relative to process.cwd() rather than import.meta.url so the path
// survives Next.js webpack bundling. The Dockerfile copies lib/db/migrations
// into /app/lib/db/migrations (cwd is /app at runtime). Vitest runs from
// eloup-web/, so this resolves to eloup-web/lib/db/migrations there.
const MIGRATIONS_DIR =
  process.env.ELOUP_MIGRATIONS_DIR ?? join(process.cwd(), 'lib', 'db', 'migrations');

type Migration = { version: number; name: string; sql: string };

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((f) => {
    const match = f.match(/^(\d+)_(.+)\.sql$/);
    if (!match) throw new Error(`Migration filename does not match NNNN_name.sql: ${f}`);
    return {
      version: parseInt(match[1]!, 10),
      name: match[2]!,
      sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8'),
    };
  });
}

export function applyMigrations(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     );`,
  );

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );

  const migrations = loadMigrations();
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    runOne(db, m);
  }
}

function runOne(db: Database.Database, m: Migration): void {
  // BEGIN IMMEDIATE: acquire RESERVED lock at start so two concurrent
  // migrators cannot both think they're applying version N+1.
  const tries = 30;
  for (let i = 0; i < tries; i++) {
    try {
      db.exec('BEGIN IMMEDIATE');
      break;
    } catch (err) {
      if (i === tries - 1) throw err;
      sleepMs(100);
    }
  }
  try {
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_migrations(version, name) VALUES (?, ?)').run(
      m.version,
      m.name,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function sleepMs(ms: number): void {
  const deadline = Date.now() + ms;
  // Busy-wait — only ever runs in the rare retry case.
  while (Date.now() < deadline) {
    // intentionally empty
  }
}
