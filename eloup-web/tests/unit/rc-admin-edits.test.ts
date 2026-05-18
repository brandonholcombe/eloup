import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import {
  deleteRace,
  getDriverWithLinkedPlayer,
  getRace,
  setDriverPenalty,
  setDriverPlayer,
  setRaceTrack,
  setVoidedLapsCount,
  standingsForRace,
} from '@/lib/db/rc';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-rc-admin-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

// Seed a 2-driver race with deterministic totals.
// Brandon (transponder 10) finishes 0.5s ahead of Willy (transponder 20).
function seedTwoDriverRace(
  db: Database.Database,
  opts: {
    raceId?: string;
    trackId?: string;
    brandonTotalMs?: number;
    willyTotalMs?: number;
  } = {},
): {
  raceId: string;
  trackId: string;
  brandonId: string;
  willyId: string;
} {
  const raceId = opts.raceId ?? 'r1';
  const trackId = opts.trackId ?? 't1';
  const brandonTotal = opts.brandonTotalMs ?? 60_000;
  const willyTotal = opts.willyTotalMs ?? 60_500;

  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES ('admin', 'admin', 'admin', 'Admin', 'global_admin')`,
  ).run();
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES (?, ?, ?)`).run(
    trackId,
    'Track 1',
    trackId,
  );
  db.prepare(`INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES (?, ?, ?)`)
    .run('brandon', 'br-uuid', 'Brandon');
  db.prepare(`INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES (?, ?, ?)`)
    .run('willy', 'wi-uuid', 'Willy');
  db.prepare(
    `INSERT INTO rc_races(id, lap_monitor_uuid, track_id, race_started_at, race_kind,
                          source_blob, uploaded_by)
     VALUES (?, ?, ?, '2026-05-17T00:00:00Z', 'race', '{}', 'admin')`,
  ).run(raceId, raceId, trackId);
  db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                 laps_completed, best_lap_ms, total_time_ms)
     VALUES (?, 'brandon', 10, 1, 20, 2500, ?)`,
  ).run(raceId, brandonTotal);
  db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                 laps_completed, best_lap_ms, total_time_ms)
     VALUES (?, 'willy', 20, 2, 20, 2600, ?)`,
  ).run(raceId, willyTotal);

  return { raceId, trackId, brandonId: 'brandon', willyId: 'willy' };
}

describe('setRaceTrack', () => {
  it('flips track_id and returns ok', () => {
    const db = freshDb();
    const { raceId } = seedTwoDriverRace(db);
    db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES ('t2', 'Track 2', 't2')`).run();

    const result = setRaceTrack(db, raceId, 't2');
    expect(result).toEqual({ status: 'ok' });
    const row = db.prepare(`SELECT track_id FROM rc_races WHERE id = ?`).get(raceId) as {
      track_id: string;
    };
    expect(row.track_id).toBe('t2');
  });

  it('idempotent — re-running with the same trackId is a no-op', () => {
    const db = freshDb();
    const { raceId, trackId } = seedTwoDriverRace(db);
    expect(setRaceTrack(db, raceId, trackId)).toEqual({ status: 'ok' });
    expect(setRaceTrack(db, raceId, trackId)).toEqual({ status: 'ok' });
    const row = db.prepare(`SELECT track_id FROM rc_races WHERE id = ?`).get(raceId) as {
      track_id: string;
    };
    expect(row.track_id).toBe(trackId);
  });

  it('returns no_race for an unknown race id', () => {
    const db = freshDb();
    const { trackId } = seedTwoDriverRace(db);
    expect(setRaceTrack(db, 'missing', trackId)).toEqual({ status: 'no_race' });
  });

  it('returns no_track for an unknown track id', () => {
    const db = freshDb();
    const { raceId } = seedTwoDriverRace(db);
    expect(setRaceTrack(db, raceId, 'nope')).toEqual({ status: 'no_track' });
  });
});

describe('setDriverPenalty', () => {
  it('writes penalty_ms and standings reflect adjusted_total_time_ms', () => {
    const db = freshDb();
    const { raceId, brandonId } = seedTwoDriverRace(db);
    expect(setDriverPenalty(db, raceId, brandonId, 5000)).toEqual({ status: 'ok' });

    const standings = standingsForRace(db, raceId);
    const brandon = standings.find((s) => s.driver_id === brandonId)!;
    expect(brandon.penalty_ms).toBe(5000);
    expect(brandon.adjusted_total_time_ms).toBe(65_000);
  });

  it('penalty_ms = 0 on a fresh row preserves import order', () => {
    const db = freshDb();
    const { raceId, brandonId, willyId } = seedTwoDriverRace(db);
    expect(setDriverPenalty(db, raceId, brandonId, 0)).toEqual({ status: 'ok' });
    const standings = standingsForRace(db, raceId);
    // Brandon < Willy on total_time_ms, so Brandon stays placement 1.
    expect(standings.find((s) => s.driver_id === brandonId)!.placement).toBe(1);
    expect(standings.find((s) => s.driver_id === willyId)!.placement).toBe(2);
  });

  it('rejects non-integer / negative penalties with invalid', () => {
    const db = freshDb();
    const { raceId, brandonId } = seedTwoDriverRace(db);
    expect(setDriverPenalty(db, raceId, brandonId, -1)).toEqual({ status: 'invalid' });
    expect(setDriverPenalty(db, raceId, brandonId, 1.5)).toEqual({ status: 'invalid' });
    expect(setDriverPenalty(db, raceId, brandonId, Number.NaN)).toEqual({ status: 'invalid' });
  });

  it('returns no_row for an unknown (race, driver)', () => {
    const db = freshDb();
    const { raceId } = seedTwoDriverRace(db);
    expect(setDriverPenalty(db, raceId, 'nope', 1000)).toEqual({ status: 'no_row' });
    expect(setDriverPenalty(db, 'nope', 'brandon', 1000)).toEqual({ status: 'no_row' });
  });

  it('accepts 600000 — the API-layer cap is not enforced at the DB function', () => {
    const db = freshDb();
    const { raceId, brandonId } = seedTwoDriverRace(db);
    expect(setDriverPenalty(db, raceId, brandonId, 600_000)).toEqual({ status: 'ok' });
    const row = db
      .prepare(`SELECT penalty_ms FROM rc_race_drivers WHERE race_id = ? AND driver_id = ?`)
      .get(raceId, brandonId) as { penalty_ms: number };
    expect(row.penalty_ms).toBe(600_000);
  });

  it('placement reorders when penalty closes the gap and overtakes', () => {
    const db = freshDb();
    // Brandon ahead by 0.5s; +5s penalty drops him to 2nd.
    const { raceId, brandonId, willyId } = seedTwoDriverRace(db);

    expect(setDriverPenalty(db, raceId, brandonId, 5000)).toEqual({ status: 'ok' });
    const standings = standingsForRace(db, raceId);
    expect(standings.find((s) => s.driver_id === brandonId)!.placement).toBe(2);
    expect(standings.find((s) => s.driver_id === willyId)!.placement).toBe(1);
  });

  it('clearing penalty back to 0 restores the original placement', () => {
    const db = freshDb();
    const { raceId, brandonId, willyId } = seedTwoDriverRace(db);

    setDriverPenalty(db, raceId, brandonId, 5000);
    expect(setDriverPenalty(db, raceId, brandonId, 0)).toEqual({ status: 'ok' });
    const standings = standingsForRace(db, raceId);
    expect(standings.find((s) => s.driver_id === brandonId)!.placement).toBe(1);
    expect(standings.find((s) => s.driver_id === willyId)!.placement).toBe(2);
  });

  it('ties on adjusted_total_time_ms fall back to transponder_id ASC', () => {
    const db = freshDb();
    // Both drivers start with identical totals = 60_000.
    const { raceId, brandonId, willyId } = seedTwoDriverRace(db, {
      brandonTotalMs: 60_000,
      willyTotalMs: 60_000,
    });
    // Apply identical penalties so adjusted totals tie again.
    setDriverPenalty(db, raceId, brandonId, 1000);
    setDriverPenalty(db, raceId, willyId, 1000);

    const standings = standingsForRace(db, raceId);
    // Brandon's transponder (10) < Willy's (20), so Brandon stays 1st.
    expect(standings.find((s) => s.driver_id === brandonId)!.placement).toBe(1);
    expect(standings.find((s) => s.driver_id === willyId)!.placement).toBe(2);
  });
});

describe('setDriverPlayer', () => {
  function seedPlayer(db: Database.Database, id: string, handle: string) {
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
       VALUES (?, ?, ?, ?, 'user')`,
    ).run(id, `discord-${id}`, handle, `Player ${id}`);
  }

  it('links a driver to a player and ok-statuses', () => {
    const db = freshDb();
    const { brandonId } = seedTwoDriverRace(db);
    seedPlayer(db, 'p1', 'p1handle');

    expect(setDriverPlayer(db, brandonId, 'p1')).toEqual({ status: 'ok' });
    const row = db
      .prepare(`SELECT player_id FROM rc_drivers WHERE id = ?`)
      .get(brandonId) as { player_id: string | null };
    expect(row.player_id).toBe('p1');
  });

  it('returns no_driver for an unknown driverId and does not mutate', () => {
    const db = freshDb();
    seedTwoDriverRace(db);
    seedPlayer(db, 'p1', 'p1handle');

    expect(setDriverPlayer(db, 'missing', 'p1')).toEqual({ status: 'no_driver' });
  });

  it('returns no_player for a real driver + bogus playerId, leaves player_id unchanged', () => {
    const db = freshDb();
    const { brandonId } = seedTwoDriverRace(db);

    expect(setDriverPlayer(db, brandonId, 'nope')).toEqual({ status: 'no_player' });
    const row = db
      .prepare(`SELECT player_id FROM rc_drivers WHERE id = ?`)
      .get(brandonId) as { player_id: string | null };
    expect(row.player_id).toBeNull();
  });

  it('null-clears an existing link', () => {
    const db = freshDb();
    const { brandonId } = seedTwoDriverRace(db);
    seedPlayer(db, 'p1', 'p1handle');
    setDriverPlayer(db, brandonId, 'p1');

    expect(setDriverPlayer(db, brandonId, null)).toEqual({ status: 'ok' });
    const row = db
      .prepare(`SELECT player_id FROM rc_drivers WHERE id = ?`)
      .get(brandonId) as { player_id: string | null };
    expect(row.player_id).toBeNull();
  });

  it('getDriverWithLinkedPlayer surfaces linked names via LEFT JOIN', () => {
    const db = freshDb();
    const { brandonId, willyId } = seedTwoDriverRace(db);
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name, role, avatar_url)
       VALUES ('p1', 'd1', 'brandonw', 'Brandon W', 'user', 'http://avatar/1.png')`,
    ).run();
    setDriverPlayer(db, brandonId, 'p1');

    const linked = getDriverWithLinkedPlayer(db, brandonId);
    expect(linked).not.toBeNull();
    expect(linked!.player_id).toBe('p1');
    expect(linked!.linked_display_name).toBe('Brandon W');
    expect(linked!.linked_discord_handle).toBe('brandonw');
    expect(linked!.linked_avatar_url).toBe('http://avatar/1.png');

    // Willy is not linked — both linked_* fields stay null.
    const unlinked = getDriverWithLinkedPlayer(db, willyId);
    expect(unlinked).not.toBeNull();
    expect(unlinked!.player_id).toBeNull();
    expect(unlinked!.linked_display_name).toBeNull();
    expect(unlinked!.linked_discord_handle).toBeNull();
    expect(unlinked!.linked_avatar_url).toBeNull();
  });
});

// Seed a qualif race with 3 drivers and known normal-lap times. Used
// for setVoidedLapsCount tests: voiding the leader's fastest lap can
// shift their top-3-avg above the runner-up's.
function seedQualifRace(db: Database.Database): {
  raceId: string;
  trackId: string;
  alphaId: string;
  bravoId: string;
  charlieId: string;
} {
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES ('admin', 'admin', 'admin', 'Admin', 'global_admin')`,
  ).run();
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES ('tq', 'TrackQ', 'tq')`).run();
  // Alpha: ranking laps fast, but top fastest is dominant. transponder 10.
  db.prepare(
    `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES ('alpha', 'a-uuid', 'Alpha')`,
  ).run();
  // Bravo: more consistent, transponder 20.
  db.prepare(
    `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES ('bravo', 'b-uuid', 'Bravo')`,
  ).run();
  // Charlie: slower, transponder 30.
  db.prepare(
    `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES ('charlie', 'c-uuid', 'Charlie')`,
  ).run();
  db.prepare(
    `INSERT INTO rc_races(id, lap_monitor_uuid, track_id, race_started_at, race_kind,
                          source_blob, uploaded_by)
     VALUES ('rq', 'rq', 'tq', '2026-05-17T00:00:00Z', 'qualif', '{}', 'admin')`,
  ).run();
  db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                 laps_completed, best_lap_ms, total_time_ms)
     VALUES ('rq', 'alpha', 10, 1, 4, 10000, 100000)`,
  ).run();
  db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                 laps_completed, best_lap_ms, total_time_ms)
     VALUES ('rq', 'bravo', 20, 2, 4, 20000, 100000)`,
  ).run();
  db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                 laps_completed, best_lap_ms, total_time_ms)
     VALUES ('rq', 'charlie', 30, 3, 4, 25000, 100000)`,
  ).run();
  // Alpha laps: 10000 (fast), 21000, 22000, 30000 → top3 raw avg ~17666
  // Bravo laps: 20000, 20500, 21000, 30000 → top3 raw avg 20500
  // Charlie laps: 25000, 26000, 27000, 30000 → top3 raw avg 26000
  const insertLap = db.prepare(
    `INSERT INTO rc_laps(race_id, driver_id, lap_index, lap_number,
                          lap_time_ms, end_timestamp_ms, lap_kind)
     VALUES (?, ?, ?, ?, ?, ?, 'normal')`,
  );
  const alphaLaps = [10_000, 21_000, 22_000, 30_000];
  const bravoLaps = [20_000, 20_500, 21_000, 30_000];
  const charlieLaps = [25_000, 26_000, 27_000, 30_000];
  alphaLaps.forEach((ms, i) =>
    insertLap.run('rq', 'alpha', i, i + 1, ms, (i + 1) * 30_000, ),
  );
  bravoLaps.forEach((ms, i) =>
    insertLap.run('rq', 'bravo', i, i + 1, ms, (i + 1) * 30_000),
  );
  charlieLaps.forEach((ms, i) =>
    insertLap.run('rq', 'charlie', i, i + 1, ms, (i + 1) * 30_000),
  );
  return {
    raceId: 'rq',
    trackId: 'tq',
    alphaId: 'alpha',
    bravoId: 'bravo',
    charlieId: 'charlie',
  };
}

describe('setVoidedLapsCount', () => {
  it('happy: writes the value and standings reflect voided_laps_count', () => {
    const db = freshDb();
    const { raceId, alphaId } = seedQualifRace(db);
    expect(setVoidedLapsCount(db, raceId, alphaId, 1)).toEqual({ status: 'ok' });
    const standings = standingsForRace(db, raceId);
    const alpha = standings.find((s) => s.driver_id === alphaId)!;
    expect(alpha.voided_laps_count).toBe(1);
  });

  it('invalid: negative count → invalid, no row touched', () => {
    const db = freshDb();
    const { raceId, alphaId } = seedQualifRace(db);
    expect(setVoidedLapsCount(db, raceId, alphaId, -1)).toEqual({ status: 'invalid' });
    const alpha = standingsForRace(db, raceId).find((s) => s.driver_id === alphaId)!;
    expect(alpha.voided_laps_count).toBe(0);
  });

  it('invalid: non-integer count → invalid', () => {
    const db = freshDb();
    const { raceId, alphaId } = seedQualifRace(db);
    expect(setVoidedLapsCount(db, raceId, alphaId, 1.5)).toEqual({ status: 'invalid' });
    expect(setVoidedLapsCount(db, raceId, alphaId, Number.NaN)).toEqual({
      status: 'invalid',
    });
  });

  it('no_row: unknown (race, driver) → no_row', () => {
    const db = freshDb();
    const { raceId } = seedQualifRace(db);
    expect(setVoidedLapsCount(db, raceId, 'nope', 1)).toEqual({ status: 'no_row' });
    expect(setVoidedLapsCount(db, 'nope', 'alpha', 1)).toEqual({ status: 'no_row' });
  });

  it('voiding the leader\'s fastest lap reorders placement', () => {
    const db = freshDb();
    const { raceId, alphaId, bravoId } = seedQualifRace(db);
    // After import, Alpha leads (raw top3 ~17666 < Bravo's 20500).
    // Recompute placements with current data (the seed inserts placement
    // values pre-H6; the recompute via setVoidedLapsCount fires below).
    // First, set voided=0 to trigger a recompute and pin baseline.
    setVoidedLapsCount(db, raceId, alphaId, 0);
    let standings = standingsForRace(db, raceId);
    expect(standings.find((s) => s.driver_id === alphaId)!.placement).toBe(1);
    expect(standings.find((s) => s.driver_id === bravoId)!.placement).toBe(2);

    // Void Alpha's fastest lap → Alpha's top-3 becomes [21k, 22k, 30k]
    // (avg ~24333) which is worse than Bravo's 20500.
    expect(setVoidedLapsCount(db, raceId, alphaId, 1)).toEqual({ status: 'ok' });
    standings = standingsForRace(db, raceId);
    expect(standings.find((s) => s.driver_id === bravoId)!.placement).toBe(1);
    expect(standings.find((s) => s.driver_id === alphaId)!.placement).toBe(2);
  });

  it('over-voided edge case: voiding 11 laps when only 4 exist sinks the driver to last', () => {
    const db = freshDb();
    const { raceId, alphaId, charlieId } = seedQualifRace(db);
    // 11 voids on alpha → no ranking laps left → alpha falls to <3-lap
    // fallback tier, ranked by best_lap_ms (still 10000, so alpha beats
    // charlie if charlie also had <3 laps — but charlie has all 4 normal
    // laps). Alpha sinks below both 3+-lap drivers.
    expect(setVoidedLapsCount(db, raceId, alphaId, 11)).toEqual({ status: 'ok' });
    const standings = standingsForRace(db, raceId);
    const alpha = standings.find((s) => s.driver_id === alphaId)!;
    const charlie = standings.find((s) => s.driver_id === charlieId)!;
    expect(alpha.voided_laps_count).toBe(11);
    // Alpha should be last (placement 3): both Bravo and Charlie have
    // ≥3 ranking laps, while Alpha has 0.
    expect(alpha.placement).toBe(3);
    // Charlie is the slowest 3-lap driver but still beats over-voided Alpha.
    expect(charlie.placement).toBeLessThan(alpha.placement);
  });

  it('clearing voided_laps_count back to 0 restores the original ranking', () => {
    const db = freshDb();
    const { raceId, alphaId, bravoId } = seedQualifRace(db);
    setVoidedLapsCount(db, raceId, alphaId, 1);
    expect(setVoidedLapsCount(db, raceId, alphaId, 0)).toEqual({ status: 'ok' });
    const standings = standingsForRace(db, raceId);
    expect(standings.find((s) => s.driver_id === alphaId)!.placement).toBe(1);
    expect(standings.find((s) => s.driver_id === bravoId)!.placement).toBe(2);
  });
});

describe('deleteRace', () => {
  it('hard-deletes the race row and cascades to rc_race_drivers + rc_laps', () => {
    const db = freshDb();
    const { raceId } = seedTwoDriverRace(db);
    // Seed a few lap rows so cascade has something to clear.
    db.prepare(
      `INSERT INTO rc_laps(race_id, driver_id, lap_index, lap_number, lap_time_ms,
                            end_timestamp_ms, lap_kind)
       VALUES (?, 'brandon', 0, 1, 3000, 3000, 'normal')`,
    ).run(raceId);
    db.prepare(
      `INSERT INTO rc_laps(race_id, driver_id, lap_index, lap_number, lap_time_ms,
                            end_timestamp_ms, lap_kind)
       VALUES (?, 'willy', 0, 1, 3100, 3100, 'normal')`,
    ).run(raceId);

    expect(deleteRace(db, raceId)).toEqual({ status: 'ok' });
    expect(getRace(db, raceId)).toBeNull();
    const drivers = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers WHERE race_id = ?`)
      .get(raceId) as { n: number };
    expect(drivers.n).toBe(0);
    const laps = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_laps WHERE race_id = ?`)
      .get(raceId) as { n: number };
    expect(laps.n).toBe(0);
    // rc_drivers rows themselves survive — only the race-scoped rows go.
    const drivenSurvivors = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_drivers`)
      .get() as { n: number };
    expect(drivenSurvivors.n).toBe(2);
  });

  it('returns no_row for an unknown race id and does not touch other rows', () => {
    const db = freshDb();
    const { raceId } = seedTwoDriverRace(db);
    expect(deleteRace(db, 'missing')).toEqual({ status: 'no_row' });
    // Race and its driver rows still there.
    expect(getRace(db, raceId)).not.toBeNull();
    const drivers = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers WHERE race_id = ?`)
      .get(raceId) as { n: number };
    expect(drivers.n).toBe(2);
  });
});
