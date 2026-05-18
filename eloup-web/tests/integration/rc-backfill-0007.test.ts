import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';

// Run migrations through 0005 only, then seed pre-H6 placements with
// the OLD ordering (laps DESC, total ASC). Then apply 0006 + 0007 and
// assert placements were recomputed.
function migrateThrough(db: Database.Database, throughVersion: number, migrationsDir: string) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     );`,
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const match = f.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;
    const version = parseInt(match[1]!, 10);
    if (version > throughVersion) continue;
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    db.exec(sql);
    db.prepare(`INSERT INTO schema_migrations(version, name) VALUES (?, ?)`).run(
      version,
      match[2]!,
    );
  }
}

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'lib', 'db', 'migrations');

function freshDbThrough5() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-backfill-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  migrateThrough(db, 5, MIGRATIONS_DIR);
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES ('admin', 'admin', 'admin', 'Admin', 'global_admin')`,
  ).run();
  return db;
}

function applyRemaining(db: Database.Database) {
  // Apply only migrations not yet in schema_migrations.
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const match = f.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;
    const version = parseInt(match[1]!, 10);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    db.exec(sql);
    db.prepare(`INSERT INTO schema_migrations(version, name) VALUES (?, ?)`).run(
      version,
      match[2]!,
    );
  }
}

// Seed a practice race with 4 drivers whose pre-H6 placement (by laps +
// total) differs from the top-3-avg ranking. After 0007, placements
// should reflect top-3-avg.
function seedPracticeRace(
  db: Database.Database,
  raceId: string,
  raceKind: 'practice' | 'qualif' | 'race' = 'practice',
) {
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES (?, ?, ?)`).run(
    `t-${raceId}`,
    `Track ${raceId}`,
    `t-${raceId}`,
  );
  db.prepare(
    `INSERT INTO rc_races(id, lap_monitor_uuid, track_id, race_started_at, race_kind,
                          source_blob, uploaded_by)
     VALUES (?, ?, ?, '2026-05-17T00:00:00Z', ?, '{}', 'admin')`,
  ).run(raceId, raceId, `t-${raceId}`, raceKind);
}

function seedDriverWithLaps(
  db: Database.Database,
  raceId: string,
  driverId: string,
  displayName: string,
  transponderId: number,
  placementOld: number,
  lapTimesMs: number[],
  options: { extraInitialEnd?: number; extraIgnoredCount?: number } = {},
) {
  db.prepare(
    `INSERT OR IGNORE INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES (?, ?, ?)`,
  ).run(driverId, `uuid-${driverId}`, displayName);
  const totalTimeMs = lapTimesMs.reduce((a, b) => a + b, 0);
  const bestLapMs = lapTimesMs.length > 0 ? Math.min(...lapTimesMs) : null;
  db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                 laps_completed, best_lap_ms, total_time_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(raceId, driverId, transponderId, placementOld, lapTimesMs.length, bestLapMs, totalTimeMs);
  const insertLap = db.prepare(
    `INSERT INTO rc_laps(race_id, driver_id, lap_index, lap_number,
                          lap_time_ms, end_timestamp_ms, lap_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let idx = 0;
  if (options.extraInitialEnd != null) {
    insertLap.run(raceId, driverId, idx, null, 0, options.extraInitialEnd, 'initial');
    idx++;
  }
  for (let i = 0; i < lapTimesMs.length; i++) {
    insertLap.run(raceId, driverId, idx, i + 1, lapTimesMs[i]!, (i + 1) * 30_000, 'normal');
    idx++;
  }
  for (let j = 0; j < (options.extraIgnoredCount ?? 0); j++) {
    insertLap.run(raceId, driverId, idx, null, 0, idx * 30_000, 'ignored');
    idx++;
  }
}

describe('migration 0007 — qualif/practice backfill', () => {
  it('recomputes placement for practice rows to match top-3-avg ranking', () => {
    const db = freshDbThrough5();
    seedPracticeRace(db, 'rp', 'practice');
    // Old placement (laps DESC, total ASC): more laps wins; ties on total.
    // Driver "consistent" has more laps but slower top-3-avg.
    // Driver "fastpace" has fewer laps but a great top-3-avg.
    seedDriverWithLaps(db, 'rp', 'consistent', 'C', 10, 1, [
      25_000,
      26_000,
      27_000,
      28_000,
      29_000,
    ]); // top3 avg = 26_000
    seedDriverWithLaps(db, 'rp', 'fastpace', 'F', 20, 2, [
      18_000,
      19_000,
      20_000,
      30_000,
    ]); // top3 avg = 19_000
    seedDriverWithLaps(db, 'rp', 'slowpace', 'S', 30, 3, [
      30_000,
      31_000,
      32_000,
      33_000,
    ]); // top3 avg = 31_000

    applyRemaining(db);

    const standings = db
      .prepare(`SELECT driver_id, placement FROM rc_race_drivers WHERE race_id = 'rp'`)
      .all() as { driver_id: string; placement: number }[];
    const byDriver = new Map(standings.map((s) => [s.driver_id, s.placement]));
    expect(byDriver.get('fastpace')).toBe(1);
    expect(byDriver.get('consistent')).toBe(2);
    expect(byDriver.get('slowpace')).toBe(3);
  });

  it('zero-normal-lap driver sinks to the bottom (MAJOR #2 fix)', () => {
    // The reviewer's catch: a driver with only `initial`/`ignored` laps
    // has zero normal laps. Pre-fix, the INNER JOIN to `rc_laps` filtered
    // them out and they kept their old (stale) placement via COALESCE.
    // With the LEFT JOIN fix, they appear with top3_count=0 and sink.
    const db = freshDbThrough5();
    seedPracticeRace(db, 'rz', 'practice');
    seedDriverWithLaps(db, 'rz', 'lapper', 'L', 10, 3 /* old placement */, [
      20_000,
      21_000,
      22_000,
    ]); // top3 avg 21000
    // Pre-H6, this driver had been placed FIRST (a bug, perhaps), with
    // only an initial lap and ignored laps. They must sink to the bottom
    // after 0007.
    seedDriverWithLaps(
      db,
      'rz',
      'noruns',
      'N',
      20,
      1 /* stale placement of 1 */,
      [],
      { extraInitialEnd: 5000, extraIgnoredCount: 3 },
    );
    seedDriverWithLaps(db, 'rz', 'midpace', 'M', 30, 2, [
      25_000,
      26_000,
      27_000,
    ]); // top3 avg 26000

    applyRemaining(db);

    const byDriver = new Map(
      (db
        .prepare(`SELECT driver_id, placement FROM rc_race_drivers WHERE race_id = 'rz'`)
        .all() as { driver_id: string; placement: number }[]).map(
        (s) => [s.driver_id, s.placement] as const,
      ),
    );
    expect(byDriver.get('lapper')).toBe(1); // fastest top3-avg
    expect(byDriver.get('midpace')).toBe(2);
    expect(byDriver.get('noruns')).toBe(3); // zero normal laps → bottom
  });

  it('is idempotent — running migrate twice yields the same placements', () => {
    const db = freshDbThrough5();
    seedPracticeRace(db, 'ri', 'qualif');
    seedDriverWithLaps(db, 'ri', 'a', 'A', 10, 1, [18_000, 19_000, 20_000]);
    seedDriverWithLaps(db, 'ri', 'b', 'B', 20, 2, [22_000, 23_000, 24_000]);
    applyRemaining(db);

    const before = (db
      .prepare(`SELECT driver_id, placement FROM rc_race_drivers WHERE race_id = 'ri' ORDER BY driver_id`)
      .all() as { driver_id: string; placement: number }[]);

    // Re-running applyMigrations on a fully-migrated DB is a no-op.
    applyMigrations(db);
    const after = (db
      .prepare(`SELECT driver_id, placement FROM rc_race_drivers WHERE race_id = 'ri' ORDER BY driver_id`)
      .all() as { driver_id: string; placement: number }[]);
    expect(after).toEqual(before);
  });

  it('race-kind rows are untouched by 0007', () => {
    const db = freshDbThrough5();
    // Race-kind: placements must NOT change after 0007.
    seedPracticeRace(db, 'rr', 'race');
    seedDriverWithLaps(db, 'rr', 'x', 'X', 10, 1, [
      30_000,
      31_000,
      32_000,
    ]);
    seedDriverWithLaps(db, 'rr', 'y', 'Y', 20, 2, [
      18_000,
      19_000,
      20_000,
    ]);
    const racePlacementsBefore = (db
      .prepare(`SELECT driver_id, placement FROM rc_race_drivers WHERE race_id = 'rr' ORDER BY driver_id`)
      .all() as { driver_id: string; placement: number }[]);

    applyRemaining(db);

    const racePlacementsAfter = (db
      .prepare(`SELECT driver_id, placement FROM rc_race_drivers WHERE race_id = 'rr' ORDER BY driver_id`)
      .all() as { driver_id: string; placement: number }[]);
    expect(racePlacementsAfter).toEqual(racePlacementsBefore);
  });
});

