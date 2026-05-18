import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-migrate-'));
  return join(dir, 'test.sqlite');
}

describe('applyMigrations', () => {
  it('creates all tables on a fresh DB and records every migration version', () => {
    const path = tempDbPath();
    const db = new Database(path);
    db.pragma('foreign_keys = ON');
    applyMigrations(db);

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'players',
        'games',
        'matches',
        'match_participants',
        'ratings',
        'overall_ratings',
        'tournaments',
        'tournament_admins',
        'tournament_members',
        'bets',
        'rc_tracks',
        'rc_drivers',
        'rc_races',
        'rc_race_drivers',
        'rc_laps',
        'schema_migrations',
      ]),
    );

    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
    db.close();
  });

  it('0005 adds penalty_ms to rc_race_drivers with default 0 (idempotent)', () => {
    const path = tempDbPath();
    const db = new Database(path);
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    // Re-running migrate must not re-apply 0005.
    applyMigrations(db);

    const cols = db.prepare(`PRAGMA table_info(rc_race_drivers)`).all() as {
      name: string;
      dflt_value: string | number | null;
      notnull: number;
    }[];
    const penalty = cols.find((c) => c.name === 'penalty_ms');
    expect(penalty).toBeTruthy();
    expect(penalty!.notnull).toBe(1);
    // SQLite reports the default as a literal string.
    expect(String(penalty!.dflt_value)).toBe('0');

    // CHECK constraint rejects negative penalty.
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
    ).run('p1', '111', 'p1', 'P1');
    db.prepare(
      `INSERT INTO rc_tracks(id, name, slug) VALUES ('t', 'T', 't')`,
    ).run();
    db.prepare(
      `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES ('d', 'd', 'D')`,
    ).run();
    db.prepare(
      `INSERT INTO rc_races(id, lap_monitor_uuid, track_id, race_started_at, race_kind,
                            source_blob, uploaded_by)
       VALUES ('r', 'rr', 't', '2026-05-17', 'race', '{}', 'p1')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                       laps_completed, total_time_ms, penalty_ms)
           VALUES ('r', 'd', 1, 1, 5, 1000, -1)`,
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it('is a no-op on a fully-migrated DB', () => {
    const path = tempDbPath();
    const db = new Database(path);
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const before = db.prepare('SELECT version FROM schema_migrations').all() as {
      version: number;
    }[];
    applyMigrations(db);
    const after = db.prepare('SELECT version FROM schema_migrations').all() as {
      version: number;
    }[];
    expect(after).toEqual(before);
    db.close();
  });

  it('applies CHECK constraint on overall_ratings.current_rating', () => {
    const path = tempDbPath();
    const db = new Database(path);
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
    ).run('p1', '111', 'a', 'A');
    expect(() =>
      db
        .prepare(`INSERT INTO overall_ratings(player_id, current_rating) VALUES (?, ?)`)
        .run('p1', -5),
    ).toThrow();
    db.close();
  });

  it('applies CHECK constraint on players.role enum', () => {
    const path = tempDbPath();
    const db = new Database(path);
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO players(id, discord_id, discord_handle, display_name, role) VALUES (?, ?, ?, ?, ?)`,
        )
        .run('p1', '111', 'a', 'A', 'super_admin'),
    ).toThrow();
    db.close();
  });
});
