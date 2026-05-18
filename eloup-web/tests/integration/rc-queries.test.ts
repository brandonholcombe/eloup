import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { importLapMonitorJson } from '@/lib/rc/import';
import {
  bestLapsForTrack,
  driverWinLossStats,
  getRace,
  lapsForRace,
  listDrivers,
  listRaces,
  listTracks,
  perTrackBestsForDriver,
  recentRacesForDriver,
  standingsForRace,
} from '@/lib/db/rc';

const FIXTURE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'Agents',
  'fixtures',
  'lap-monitor-sample.json',
);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-rc-queries-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES ('admin', 'admin', 'admin', 'Admin', 'global_admin')`,
  ).run();
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES ('track-a', 'Track A', 'track-a')`).run();
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES ('track-b', 'Track B', 'track-b')`).run();
  const json = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  importLapMonitorJson(db, json, 'track-a', 'admin');
  return db;
}

describe('rc query helpers', () => {
  it('listRaces returns reverse-chrono order', () => {
    const db = setup();
    const races = listRaces(db);
    expect(races.length).toBe(15);
    for (let i = 1; i < races.length; i++) {
      expect(races[i - 1]!.race_started_at >= races[i]!.race_started_at).toBe(true);
    }
  });

  it('listRaces({ trackId }) filters by track', () => {
    const db = setup();
    expect(listRaces(db, { trackId: 'track-a' }).length).toBe(15);
    expect(listRaces(db, { trackId: 'track-b' }).length).toBe(0);
  });

  it('listRaces surfaces driver_count and winner_display_name', () => {
    const db = setup();
    const races = listRaces(db);
    for (const r of races) {
      expect(r.driver_count).toBe(2);
      expect(r.winner_display_name).toBeTruthy();
    }
  });

  it('getRace returns the joined track + winner info', () => {
    const db = setup();
    const first = listRaces(db)[0]!;
    const fetched = getRace(db, first.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.track_slug).toBe('track-a');
    expect(fetched!.driver_count).toBe(2);
  });

  it('standingsForRace returns rows ordered by placement', () => {
    const db = setup();
    const first = listRaces(db)[0]!;
    const standings = standingsForRace(db, first.id);
    expect(standings.length).toBe(2);
    expect(standings[0]!.placement).toBe(1);
    expect(standings[1]!.placement).toBe(2);
  });

  it('lapsForRace returns laps grouped per driver in lap_index order', () => {
    const db = setup();
    const first = listRaces(db)[0]!;
    const laps = lapsForRace(db, first.id);
    expect(laps.length).toBeGreaterThan(0);
    const indicesByDriver = new Map<string, number[]>();
    for (const l of laps) {
      const arr = indicesByDriver.get(l.driver_id) ?? [];
      arr.push(l.lap_index);
      indicesByDriver.set(l.driver_id, arr);
    }
    for (const [, arr] of indicesByDriver) {
      for (let i = 1; i < arr.length; i++) expect(arr[i]! > arr[i - 1]!).toBe(true);
    }
  });

  it('bestLapsForTrack ranks ascending by lap_time_ms', () => {
    const db = setup();
    const bests = bestLapsForTrack(db, 'track-a');
    expect(bests.length).toBe(2);
    expect(bests[0]!.lap_time_ms).toBeLessThanOrEqual(bests[1]!.lap_time_ms);
  });

  it('recentRacesForDriver returns reverse-chrono races', () => {
    const db = setup();
    const drivers = listDrivers(db);
    expect(drivers.length).toBe(2);
    const driverId = drivers[0]!.id;
    const recent = recentRacesForDriver(db, driverId);
    expect(recent.length).toBeGreaterThan(0);
    for (let i = 1; i < recent.length; i++) {
      expect(recent[i - 1]!.race_started_at >= recent[i]!.race_started_at).toBe(true);
    }
  });

  it('perTrackBestsForDriver groups bests per track', () => {
    const db = setup();
    const driverId = listDrivers(db)[0]!.id;
    const bests = perTrackBestsForDriver(db, driverId);
    expect(bests.length).toBe(1);
    expect(bests[0]!.track_slug).toBe('track-a');
    expect(bests[0]!.best_lap_ms).toBeGreaterThan(0);
  });

  it('listTracks returns both seeded tracks', () => {
    const db = setup();
    const tracks = listTracks(db);
    expect(tracks.map((t) => t.slug).sort()).toEqual(['track-a', 'track-b']);
  });

  it('driverWinLossStats aggregates seeded race outcomes per kind + totals', () => {
    const db = setup();
    // The lap-monitor fixture seeds 15 races all of one kind. Just
    // sanity-check the totals row sums the per-kind rows for the first
    // driver across the entire dataset.
    const driverId = listDrivers(db)[0]!.id;
    const rows = driverWinLossStats(db, driverId);
    expect(rows.map((r) => r.raceKind)).toEqual(['race', 'qualif', 'practice', 'all']);
    const byKind = Object.fromEntries(rows.map((r) => [r.raceKind, r]));
    expect(byKind.all!.totalRaces).toBe(
      byKind.race!.totalRaces + byKind.qualif!.totalRaces + byKind.practice!.totalRaces,
    );
    expect(byKind.all!.wins).toBe(
      byKind.race!.wins + byKind.qualif!.wins + byKind.practice!.wins,
    );
    expect(byKind.all!.podiums).toBe(
      byKind.race!.podiums + byKind.qualif!.podiums + byKind.practice!.podiums,
    );
    // Driver played in at least one of the kinds.
    expect(byKind.all!.totalRaces).toBeGreaterThan(0);
  });
});
