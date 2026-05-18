import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { importLapMonitorJson } from '@/lib/rc/import';
import {
  bestLapsForTrack,
  listRaces,
  setDriverPenalty,
  setRaceTrack,
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
  const dir = mkdtempSync(join(tmpdir(), 'eloup-rc-admin-int-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES ('admin', 'admin', 'admin', 'Admin', 'global_admin')`,
  ).run();
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES ('track-a', 'Track A', 'track-a')`)
    .run();
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES ('track-b', 'Track B', 'track-b')`)
    .run();
  const json = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const result = importLapMonitorJson(db, json, 'track-a', 'admin');
  if (result.status !== 'ok') throw new Error('import failed');
  return { db, raceIds: result.raceIds };
}

describe('rc admin edits — end-to-end', () => {
  it('applying a penalty surfaces adjusted_total_time_ms and reorders placements', () => {
    const { db } = setup();
    // Use the closest race (race 1 in the fixture has Brandon at 1, Willy at 2
    // with totals close enough that a 5s penalty inverts the order).
    const firstRace = listRaces(db)[14]!; // earliest fixture race
    const before = standingsForRace(db, firstRace.id);
    const leader = before.find((s) => s.placement === 1)!;
    const runnerUp = before.find((s) => s.placement === 2)!;
    const gap = runnerUp.total_time_ms - leader.total_time_ms;

    const penalty = gap + 1000; // guaranteed to invert
    const res = setDriverPenalty(db, firstRace.id, leader.driver_id, penalty);
    expect(res).toEqual({ status: 'ok' });

    const after = standingsForRace(db, firstRace.id);
    const sameLeader = after.find((s) => s.driver_id === leader.driver_id)!;
    const sameRunnerUp = after.find((s) => s.driver_id === runnerUp.driver_id)!;
    expect(sameLeader.penalty_ms).toBe(penalty);
    expect(sameLeader.adjusted_total_time_ms).toBe(leader.total_time_ms + penalty);
    expect(sameLeader.placement).toBe(2);
    expect(sameRunnerUp.placement).toBe(1);
  });

  it('clearing penalty back to 0 restores the original placement order', () => {
    const { db } = setup();
    const race = listRaces(db)[14]!;
    const before = standingsForRace(db, race.id);
    const leader = before.find((s) => s.placement === 1)!;
    setDriverPenalty(db, race.id, leader.driver_id, 50_000);
    setDriverPenalty(db, race.id, leader.driver_id, 0);

    const after = standingsForRace(db, race.id);
    const sameLeader = after.find((s) => s.driver_id === leader.driver_id)!;
    expect(sameLeader.penalty_ms).toBe(0);
    expect(sameLeader.adjusted_total_time_ms).toBe(leader.total_time_ms);
    expect(sameLeader.placement).toBe(1);
  });

  it('track change moves the race to the new track for listRaces / bestLapsForTrack', () => {
    const { db } = setup();
    const race = listRaces(db, { trackId: 'track-a' })[0]!;

    expect(setRaceTrack(db, race.id, 'track-b')).toEqual({ status: 'ok' });

    expect(listRaces(db, { trackId: 'track-a' }).map((r) => r.id)).not.toContain(race.id);
    expect(listRaces(db, { trackId: 'track-b' }).map((r) => r.id)).toContain(race.id);

    // bestLapsForTrack reflects the move: track-a's best laps lose this race's
    // lap times, track-b gains them.
    const bTrackB = bestLapsForTrack(db, 'track-b');
    expect(bTrackB.length).toBeGreaterThan(0);
  });

  it('re-importing the same JSON after a track change still dedupes by lap_monitor_uuid', () => {
    const { db } = setup();
    const race = listRaces(db)[0]!;
    setRaceTrack(db, race.id, 'track-b');

    const json = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const result = importLapMonitorJson(db, json, 'track-a', 'admin');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.summary.insertedRaces).toBe(0);
    expect(result.summary.duplicateRaces).toBe(15);
    // The moved race retains its new track assignment — dedupe doesn't reset it.
    const stillOnB = listRaces(db, { trackId: 'track-b' }).map((r) => r.id);
    expect(stillOnB).toContain(race.id);
  });
});
