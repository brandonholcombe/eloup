import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import {
  setDriverPenalty,
  setRaceTrack,
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
