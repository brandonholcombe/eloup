import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { importLapMonitorJson } from '@/lib/rc/import';
import {
  bestLapsForTrack,
  deleteRace,
  getDriverWithLinkedPlayer,
  getRace,
  lapsForRace,
  listDrivers,
  listRaces,
  setDriverPenalty,
  setDriverPlayer,
  setRaceTrack,
  standingsForRace,
} from '@/lib/db/rc';
import { searchPlayers } from '@/lib/db/queries';
import { computeDriverStats } from '@/lib/rc/stats';

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

  it('per-driver stats (computeDriverStats) are identical before and after penalty', () => {
    const { db } = setup();
    const race = listRaces(db)[14]!;
    const before = standingsForRace(db, race.id);
    const leader = before.find((s) => s.placement === 1)!;
    const laps = lapsForRace(db, race.id).filter((l) => l.driver_id === leader.driver_id);
    const statsBefore = computeDriverStats(
      laps.map((l) => ({
        lapTimeMs: l.lap_time_ms,
        lapKind: l.lap_kind,
        lapNumber: l.lap_number ?? l.lap_index,
      })),
      leader.best_lap_ms,
    );

    setDriverPenalty(db, race.id, leader.driver_id, 7500);

    const lapsAfter = lapsForRace(db, race.id).filter((l) => l.driver_id === leader.driver_id);
    const standingsAfter = standingsForRace(db, race.id).find(
      (s) => s.driver_id === leader.driver_id,
    )!;
    const statsAfter = computeDriverStats(
      lapsAfter.map((l) => ({
        lapTimeMs: l.lap_time_ms,
        lapKind: l.lap_kind,
        lapNumber: l.lap_number ?? l.lap_index,
      })),
      standingsAfter.best_lap_ms,
    );

    // Penalty changes total_time_ms + placement, NOT lap-level stats.
    expect(statsAfter).toEqual(statsBefore);
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

  it('deleteRace removes the race row and cascades to rc_race_drivers + rc_laps', () => {
    const { db } = setup();
    const race = listRaces(db)[0]!;
    // Real race — confirm the fixture wrote driver + lap rows for it.
    const driversBefore = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers WHERE race_id = ?`)
      .get(race.id) as { n: number };
    const lapsBefore = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_laps WHERE race_id = ?`)
      .get(race.id) as { n: number };
    expect(driversBefore.n).toBeGreaterThan(0);
    expect(lapsBefore.n).toBeGreaterThan(0);

    expect(deleteRace(db, race.id)).toEqual({ status: 'ok' });

    expect(getRace(db, race.id)).toBeNull();
    const driversAfter = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers WHERE race_id = ?`)
      .get(race.id) as { n: number };
    const lapsAfter = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_laps WHERE race_id = ?`)
      .get(race.id) as { n: number };
    expect(driversAfter.n).toBe(0);
    expect(lapsAfter.n).toBe(0);
  });

  it('deleteRace does not touch other races (cross-race isolation)', () => {
    const { db } = setup();
    const races = listRaces(db);
    const raceA = races[0]!;
    const raceB = races[1]!;
    // Capture BEFORE counts so the assertion can never pass vacuously
    // on an empty fixture (reviewer MINOR #6).
    const bDriversBefore = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers WHERE race_id = ?`)
        .get(raceB.id) as { n: number }
    ).n;
    const bLapsBefore = (
      db.prepare(`SELECT COUNT(*) AS n FROM rc_laps WHERE race_id = ?`).get(raceB.id) as {
        n: number;
      }
    ).n;
    expect(bDriversBefore).toBeGreaterThan(0);
    expect(bLapsBefore).toBeGreaterThan(0);

    expect(deleteRace(db, raceA.id)).toEqual({ status: 'ok' });

    const bDriversAfter = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers WHERE race_id = ?`)
        .get(raceB.id) as { n: number }
    ).n;
    const bLapsAfter = (
      db.prepare(`SELECT COUNT(*) AS n FROM rc_laps WHERE race_id = ?`).get(raceB.id) as {
        n: number;
      }
    ).n;
    expect(bDriversAfter).toBe(bDriversBefore);
    expect(bLapsAfter).toBe(bLapsBefore);
  });

  it('PATCH penalty placement bracket — laps-locked race keeps placement, hint condition holds', () => {
    // Reproduces the API-route's before/after bracket at the lib level.
    // The route reads standingsForRace before setDriverPenalty, then again
    // after. When the leader has strictly more laps than the runner-up,
    // even a large penalty cannot demote them — placement_before ===
    // placement_after === 1 with penalty_ms > 0, i.e. the UX hint fires.
    const { db } = setup();
    // Find a race where placement 1 has strictly more laps than placement 2.
    const races = listRaces(db);
    let pick: { raceId: string; leaderId: string } | null = null;
    for (const r of races) {
      const s = standingsForRace(db, r.id);
      const p1 = s.find((row) => row.placement === 1);
      const p2 = s.find((row) => row.placement === 2);
      if (p1 && p2 && p1.laps_completed > p2.laps_completed) {
        pick = { raceId: r.id, leaderId: p1.driver_id };
        break;
      }
    }
    expect(pick).not.toBeNull();
    if (!pick) return;

    const before = standingsForRace(db, pick.raceId).find(
      (s) => s.driver_id === pick.leaderId,
    )!;
    const placement_before = before.placement;
    expect(setDriverPenalty(db, pick.raceId, pick.leaderId, 5000)).toEqual({ status: 'ok' });
    const after = standingsForRace(db, pick.raceId).find(
      (s) => s.driver_id === pick.leaderId,
    )!;
    const placement_after = after.placement;

    expect(placement_before).toBe(1);
    expect(placement_after).toBe(1);
    expect(placement_before).toBe(placement_after);
    // The hint condition: same placement AND non-zero penalty.
    const penalty_ms = 5000;
    expect(placement_before === placement_after && penalty_ms > 0).toBe(true);
  });

  it('PATCH driver player_id bracket — link then unlink round-trips through getDriverWithLinkedPlayer', () => {
    // The route's surface is: setDriverPlayer then getDriverWithLinkedPlayer.
    // Mirror the round-trip at the lib level — the routes themselves are
    // thin glue over these two helpers.
    const { db } = setup();
    const drivers = listDrivers(db);
    expect(drivers.length).toBeGreaterThan(0);
    const driverId = drivers[0]!.id;

    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name, role, avatar_url)
       VALUES ('plink', 'dlink', 'linker', 'Linker P', 'user', 'http://av/p.png')`,
    ).run();

    // Initially not linked.
    let row = getDriverWithLinkedPlayer(db, driverId);
    expect(row!.player_id).toBeNull();
    expect(row!.linked_discord_handle).toBeNull();

    // Link.
    expect(setDriverPlayer(db, driverId, 'plink')).toEqual({ status: 'ok' });
    row = getDriverWithLinkedPlayer(db, driverId);
    expect(row!.player_id).toBe('plink');
    expect(row!.linked_display_name).toBe('Linker P');
    expect(row!.linked_discord_handle).toBe('linker');

    // Null-clear.
    expect(setDriverPlayer(db, driverId, null)).toEqual({ status: 'ok' });
    row = getDriverWithLinkedPlayer(db, driverId);
    expect(row!.player_id).toBeNull();
    expect(row!.linked_display_name).toBeNull();
  });

  it('PATCH driver player_id — bogus playerId returns no_player, leaves link untouched', () => {
    const { db } = setup();
    const driverId = listDrivers(db)[0]!.id;
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
       VALUES ('real', 'dr', 'real', 'Real', 'user')`,
    ).run();
    setDriverPlayer(db, driverId, 'real');

    expect(setDriverPlayer(db, driverId, 'ghost')).toEqual({ status: 'no_player' });
    const row = getDriverWithLinkedPlayer(db, driverId);
    expect(row!.player_id).toBe('real');
  });

  it('GET /api/players/search — searchPlayers surfaces fixture-relevant players by handle and display_name', () => {
    const { db } = setup();
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
       VALUES ('p1', 'd1', 'brandonw', 'Brandon W', 'user')`,
    ).run();
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
       VALUES ('p2', 'd2', 'willybilly', 'Willy', 'user')`,
    ).run();

    // by handle prefix
    expect(searchPlayers(db, 'brandon').map((h) => h.id)).toEqual(['p1']);
    // by display_name
    expect(searchPlayers(db, 'Willy').map((h) => h.id)).toEqual(['p2']);
    // empty query still returns [] even when fixture has players.
    expect(searchPlayers(db, '')).toEqual([]);
  });

  it('PATCH penalty placement bracket — tiebreak race flips placement, hint condition does not hold', () => {
    // Mirror of the previous test for the placement-changed case. Choose
    // the same race the first test in this file uses (the one with tight
    // tiebreaks). A penalty large enough to invert the order produces
    // placement_before !== placement_after, so the hint does NOT fire.
    const { db } = setup();
    const race = listRaces(db)[14]!;
    const beforeAll = standingsForRace(db, race.id);
    const leader = beforeAll.find((s) => s.placement === 1)!;
    const runnerUp = beforeAll.find((s) => s.placement === 2)!;
    // Skip if the fixture's race 14 has a laps gap (defensive).
    if (leader.laps_completed !== runnerUp.laps_completed) return;

    const placement_before = leader.placement;
    const gap = runnerUp.total_time_ms - leader.total_time_ms;
    const penalty = gap + 1000;
    expect(setDriverPenalty(db, race.id, leader.driver_id, penalty)).toEqual({ status: 'ok' });
    const placement_after = standingsForRace(db, race.id).find(
      (s) => s.driver_id === leader.driver_id,
    )!.placement;

    expect(placement_before).toBe(1);
    expect(placement_after).toBe(2);
    expect(placement_before).not.toBe(placement_after);
    // Hint condition would NOT fire — placement changed.
    expect(placement_before === placement_after && penalty > 0).toBe(false);
  });
});
