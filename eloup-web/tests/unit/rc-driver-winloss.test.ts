import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { driverWinLossStats } from '@/lib/db/rc';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-winloss-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name)
     VALUES ('admin', 'admin', 'admin', 'Admin')`,
  ).run();
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES ('t', 'T', 't')`).run();
  return db;
}

function seedDriver(db: Database.Database, id: string) {
  db.prepare(
    `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name)
     VALUES (?, ?, ?)`,
  ).run(id, id, id);
}

function seedRace(
  db: Database.Database,
  raceId: string,
  raceKind: 'race' | 'qualif' | 'practice',
) {
  db.prepare(
    `INSERT INTO rc_races(id, lap_monitor_uuid, track_id, race_started_at, race_kind,
                          source_blob, uploaded_by)
     VALUES (?, ?, 't', ?, ?, '{}', 'admin')`,
  ).run(raceId, raceId, `2026-05-${raceId.slice(-2).padStart(2, '0')}`, raceKind);
}

function seedRaceDriver(
  db: Database.Database,
  raceId: string,
  driverId: string,
  placement: number,
  transponderId: number,
) {
  db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                 laps_completed, total_time_ms)
     VALUES (?, ?, ?, ?, 5, 60000)`,
  ).run(raceId, driverId, transponderId, placement);
}

describe('driverWinLossStats', () => {
  it('always returns 4 rows in the order race, qualif, practice, all', () => {
    const db = freshDb();
    seedDriver(db, 'd1');
    const rows = driverWinLossStats(db, 'd1');
    expect(rows.map((r) => r.raceKind)).toEqual(['race', 'qualif', 'practice', 'all']);
    // No races seeded → all zeros.
    expect(rows.every((r) => r.totalRaces === 0 && r.wins === 0 && r.podiums === 0)).toBe(true);
  });

  it('counts wins (placement=1) and podiums (placement<=3) per race kind', () => {
    const db = freshDb();
    seedDriver(db, 'd1');
    // Three race-kind races: placements 1, 2, 5 → 1 win, 2 podiums (1+2).
    seedRace(db, 'r01', 'race');
    seedRace(db, 'r02', 'race');
    seedRace(db, 'r03', 'race');
    seedRaceDriver(db, 'r01', 'd1', 1, 1);
    seedRaceDriver(db, 'r02', 'd1', 2, 1);
    seedRaceDriver(db, 'r03', 'd1', 5, 1);

    const rows = driverWinLossStats(db, 'd1');
    const race = rows.find((r) => r.raceKind === 'race')!;
    expect(race.totalRaces).toBe(3);
    expect(race.wins).toBe(1);
    expect(race.podiums).toBe(2);
  });

  it('aggregates across all three race_kinds correctly in the totals row', () => {
    const db = freshDb();
    seedDriver(db, 'd1');
    // race: 1 race, 1 win, 1 podium.
    seedRace(db, 'r01', 'race');
    seedRaceDriver(db, 'r01', 'd1', 1, 1);
    // qualif: 2 qualifs, 0 wins, 1 podium (3rd place).
    seedRace(db, 'q01', 'qualif');
    seedRace(db, 'q02', 'qualif');
    seedRaceDriver(db, 'q01', 'd1', 3, 1);
    seedRaceDriver(db, 'q02', 'd1', 4, 1);
    // practice: 1 practice, 1 win, 1 podium.
    seedRace(db, 'p01', 'practice');
    seedRaceDriver(db, 'p01', 'd1', 1, 1);

    const rows = driverWinLossStats(db, 'd1');
    const byKind = Object.fromEntries(rows.map((r) => [r.raceKind, r]));
    expect(byKind.race!.totalRaces).toBe(1);
    expect(byKind.race!.wins).toBe(1);
    expect(byKind.race!.podiums).toBe(1);
    expect(byKind.qualif!.totalRaces).toBe(2);
    expect(byKind.qualif!.wins).toBe(0);
    expect(byKind.qualif!.podiums).toBe(1);
    expect(byKind.practice!.totalRaces).toBe(1);
    expect(byKind.practice!.wins).toBe(1);
    expect(byKind.practice!.podiums).toBe(1);
    // Totals row is the sum.
    expect(byKind.all!.totalRaces).toBe(4);
    expect(byKind.all!.wins).toBe(2);
    expect(byKind.all!.podiums).toBe(3);
  });

  it('returns zero rows for missing race kinds even when others have data', () => {
    const db = freshDb();
    seedDriver(db, 'd1');
    seedRace(db, 'q01', 'qualif');
    seedRaceDriver(db, 'q01', 'd1', 1, 1);

    const rows = driverWinLossStats(db, 'd1');
    const byKind = Object.fromEntries(rows.map((r) => [r.raceKind, r]));
    expect(byKind.race!.totalRaces).toBe(0);
    expect(byKind.practice!.totalRaces).toBe(0);
    expect(byKind.qualif!.totalRaces).toBe(1);
    expect(byKind.all!.totalRaces).toBe(1);
    expect(byKind.all!.wins).toBe(1);
  });
});
