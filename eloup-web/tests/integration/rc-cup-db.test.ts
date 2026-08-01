import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import {
  addRaceToCup,
  createCup,
  cupRaces,
  cupStandings,
  getCupBySlug,
  listCups,
  removeRaceFromCup,
  updatePointsScheme,
} from '@/lib/db/rc-cup';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-rc-cup-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedRc(db: Database.Database) {
  db.prepare(`INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES ('admin','admin','admin','Admin')`).run();
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES ('t1','Albion','albion')`).run();
  const drv = db.prepare(
    `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name, player_id) VALUES (?,?,?,?)`,
  );
  drv.run('d_al', 'uuid-al', 'Alice', 'admin'); // linked
  drv.run('d_bo', 'uuid-bo', 'Bob', null); // unlinked
  drv.run('d_ca', 'uuid-ca', 'Carol', null);
  const race = db.prepare(
    `INSERT INTO rc_races(id, lap_monitor_uuid, track_id, race_started_at, race_kind, source_blob, uploaded_by)
     VALUES (?,?,?,?,?,'{}','admin')`,
  );
  race.run('r1', 'u1', 't1', '2026-05-01T10:00:00', 'race');
  race.run('r2', 'u2', 't1', '2026-05-02T10:00:00', 'race');
  race.run('r3', 'u3', 't1', '2026-05-03T10:00:00', 'practice');
  const rd = db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement, laps_completed, total_time_ms)
     VALUES (?,?,?,?,?,?)`,
  );
  // r1: Alice 1, Bob 2, Carol 3
  rd.run('r1', 'd_al', 1, 1, 20, 1000);
  rd.run('r1', 'd_bo', 2, 2, 20, 1100);
  rd.run('r1', 'd_ca', 3, 3, 19, 1200);
  // r2: Bob 1, Alice 2, Carol 3
  rd.run('r2', 'd_bo', 2, 1, 20, 1000);
  rd.run('r2', 'd_al', 1, 2, 20, 1050);
  rd.run('r2', 'd_ca', 3, 3, 19, 1200);
  // r3 (practice): Carol 1 — only counts if the admin includes it
  rd.run('r3', 'd_ca', 3, 1, 10, 500);
}

describe('RC cup DB layer', () => {
  it('creates a cup with a unique slug + default scheme', () => {
    const db = freshDb();
    seedRc(db);
    const c = createCup(db, { name: 'Summer Cup', createdBy: 'admin' });
    expect(c.slug).toBe('summer-cup');
    const c2 = createCup(db, { name: 'Summer Cup', createdBy: 'admin' });
    expect(c2.slug).toBe('summer-cup-2'); // collision disambiguated
    expect(JSON.parse(c.points_scheme)).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(listCups(db).length).toBe(2);
  });

  it('standings aggregate points over the assigned races (driver-keyed)', () => {
    const db = freshDb();
    seedRc(db);
    const cup = createCup(db, { name: 'Champ', createdBy: 'admin' });
    addRaceToCup(db, cup.id, 'r1');
    addRaceToCup(db, cup.id, 'r2');
    const s = cupStandings(db, cup.id);
    // Alice: 10 + 8 = 18 (1 win). Bob: 8 + 10 = 18 (1 win). Carol: 6 + 6 = 12.
    // Alice vs Bob tie 18/1 win; best finish both 1; tiebreak name Alice<Bob.
    expect(s.map((x) => [x.displayName, x.points, x.wins])).toEqual([
      ['Alice', 18, 1],
      ['Bob', 18, 1],
      ['Carol', 12, 0],
    ]);
    // unlinked driver still present; linked player preserved
    expect(s.find((x) => x.displayName === 'Alice')?.playerId).toBe('admin');
    expect(s.find((x) => x.displayName === 'Bob')?.playerId).toBeNull();
  });

  it('adding the practice race (admin choice) changes standings; removing reverts', () => {
    const db = freshDb();
    seedRc(db);
    const cup = createCup(db, { name: 'Champ', createdBy: 'admin' });
    addRaceToCup(db, cup.id, 'r1');
    addRaceToCup(db, cup.id, 'r3'); // practice: Carol won
    let s = cupStandings(db, cup.id);
    expect(s.find((x) => x.displayName === 'Carol')?.points).toBe(6 + 10); // 3rd + practice win
    expect(cupRaces(db, cup.id).some((r) => r.race_kind === 'practice')).toBe(true);
    removeRaceFromCup(db, cup.id, 'r3');
    s = cupStandings(db, cup.id);
    expect(s.find((x) => x.displayName === 'Carol')?.points).toBe(6);
  });

  it('respects an updated points scheme', () => {
    const db = freshDb();
    seedRc(db);
    const cup = createCup(db, { name: 'Champ', createdBy: 'admin' });
    addRaceToCup(db, cup.id, 'r1');
    updatePointsScheme(db, cup.id, [3, 2, 1]); // 1st=3,2nd=2,3rd=1
    const s = cupStandings(db, cup.id);
    expect(s.find((x) => x.displayName === 'Alice')?.points).toBe(3);
    expect(s.find((x) => x.displayName === 'Carol')?.points).toBe(1);
    expect(getCupBySlug(db, cup.slug)!.points_scheme).toBe('[3,2,1]');
  });
});
