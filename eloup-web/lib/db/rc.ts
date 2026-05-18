import type Database from 'better-sqlite3';
import {
  comparePlacement,
  rankingLapTimes,
  type PlacementInput,
  type RaceKind,
} from '@/lib/rc/placement';

export type RcTrackRow = {
  id: string;
  name: string;
  slug: string;
  layout_notes: string | null;
  created_at: string;
};

export type RcDriverRow = {
  id: string;
  lap_monitor_driver_uuid: string;
  display_name: string;
  player_id: string | null;
  created_at: string;
};

export type RcRaceRow = {
  id: string;
  lap_monitor_uuid: string;
  track_id: string;
  race_started_at: string;
  race_kind: 'qualif' | 'practice' | 'race';
  race_name: string | null;
  duration_seconds: number | null;
  uploaded_by: string;
  uploaded_at: string;
};

export type RcRaceListItem = RcRaceRow & {
  track_name: string;
  track_slug: string;
  driver_count: number;
  winner_display_name: string | null;
};

export type RcStandingRow = {
  driver_id: string;
  display_name: string;
  player_id: string | null;
  transponder_id: number;
  placement: number;
  laps_completed: number;
  best_lap_ms: number | null;
  total_time_ms: number;
  penalty_ms: number;
  voided_laps_count: number;
  adjusted_total_time_ms: number;
};

export type RcLapRow = {
  driver_id: string;
  lap_index: number;
  lap_number: number | null;
  lap_time_ms: number;
  end_timestamp_ms: number;
  lap_kind: 'initial' | 'normal' | 'ignored';
};

export type RcDriverBestRow = {
  driver_id: string;
  display_name: string;
  player_id: string | null;
  lap_time_ms: number;
  race_id: string;
  race_started_at: string;
  race_name: string | null;
};

export type RcDriverRecentRaceRow = {
  race_id: string;
  race_started_at: string;
  race_kind: 'qualif' | 'practice' | 'race';
  race_name: string | null;
  track_name: string;
  track_slug: string;
  placement: number;
  laps_completed: number;
  best_lap_ms: number | null;
  total_time_ms: number;
};

export type RcDriverPerTrackBestRow = {
  track_id: string;
  track_name: string;
  track_slug: string;
  best_lap_ms: number;
};

export type RcDriverWithPlayerRow = RcDriverRow & {
  linked_display_name: string | null;
  linked_discord_handle: string | null;
  linked_avatar_url: string | null;
};

export function listTracks(db: Database.Database): RcTrackRow[] {
  return db.prepare(`SELECT * FROM rc_tracks ORDER BY name`).all() as RcTrackRow[];
}

export function getTrackBySlug(db: Database.Database, slug: string): RcTrackRow | null {
  return (
    (db.prepare(`SELECT * FROM rc_tracks WHERE slug = ?`).get(slug) as RcTrackRow | undefined) ??
    null
  );
}

export function listRaces(
  db: Database.Database,
  opts: { trackId?: string; limit?: number } = {},
): RcRaceListItem[] {
  const limit = opts.limit ?? 100;
  const params: unknown[] = [];
  let where = '';
  if (opts.trackId) {
    where = 'WHERE r.track_id = ?';
    params.push(opts.trackId);
  }
  params.push(limit);
  return db
    .prepare(
      `SELECT r.id, r.lap_monitor_uuid, r.track_id, r.race_started_at, r.race_kind,
              r.race_name, r.duration_seconds, r.uploaded_by, r.uploaded_at,
              t.name AS track_name, t.slug AS track_slug,
              (SELECT COUNT(*) FROM rc_race_drivers rd WHERE rd.race_id = r.id) AS driver_count,
              (SELECT d.display_name FROM rc_race_drivers rd
                 JOIN rc_drivers d ON d.id = rd.driver_id
                WHERE rd.race_id = r.id AND rd.placement = 1
                LIMIT 1) AS winner_display_name
         FROM rc_races r
         JOIN rc_tracks t ON t.id = r.track_id
        ${where}
        ORDER BY r.race_started_at DESC
        LIMIT ?`,
    )
    .all(...params) as RcRaceListItem[];
}

export function getRace(db: Database.Database, raceId: string): RcRaceListItem | null {
  return (
    (db
      .prepare(
        `SELECT r.id, r.lap_monitor_uuid, r.track_id, r.race_started_at, r.race_kind,
                r.race_name, r.duration_seconds, r.uploaded_by, r.uploaded_at,
                t.name AS track_name, t.slug AS track_slug,
                (SELECT COUNT(*) FROM rc_race_drivers rd WHERE rd.race_id = r.id) AS driver_count,
                (SELECT d.display_name FROM rc_race_drivers rd
                   JOIN rc_drivers d ON d.id = rd.driver_id
                  WHERE rd.race_id = r.id AND rd.placement = 1
                  LIMIT 1) AS winner_display_name
           FROM rc_races r
           JOIN rc_tracks t ON t.id = r.track_id
          WHERE r.id = ?`,
      )
      .get(raceId) as RcRaceListItem | undefined) ?? null
  );
}

export function standingsForRace(db: Database.Database, raceId: string): RcStandingRow[] {
  return db
    .prepare(
      `SELECT rd.driver_id, d.display_name, d.player_id, rd.transponder_id, rd.placement,
              rd.laps_completed, rd.best_lap_ms, rd.total_time_ms,
              rd.penalty_ms, rd.voided_laps_count,
              rd.total_time_ms + rd.penalty_ms AS adjusted_total_time_ms
         FROM rc_race_drivers rd
         JOIN rc_drivers d ON d.id = rd.driver_id
        WHERE rd.race_id = ?
        ORDER BY rd.placement`,
    )
    .all(raceId) as RcStandingRow[];
}

export function setRaceTrack(
  db: Database.Database,
  raceId: string,
  trackId: string,
): { status: 'ok' } | { status: 'no_race' } | { status: 'no_track' } {
  const tx = db.transaction(() => {
    const race = db.prepare(`SELECT id FROM rc_races WHERE id = ?`).get(raceId) as
      | { id: string }
      | undefined;
    if (!race) return { status: 'no_race' as const };
    const track = db.prepare(`SELECT id FROM rc_tracks WHERE id = ?`).get(trackId) as
      | { id: string }
      | undefined;
    if (!track) return { status: 'no_track' as const };
    db.prepare(`UPDATE rc_races SET track_id = ? WHERE id = ?`).run(trackId, raceId);
    return { status: 'ok' as const };
  });
  return tx.immediate();
}

// Shared placement-recompute primitive. Replaces the previous SQL
// ORDER-BY recompute with a JS sort using `comparePlacement` — there is
// now ONE authoritative sort function (lib/rc/placement.ts) for both the
// importer at insert time and any admin edit (penalty or void). Drift
// risk between SQL and JS sort orderings is gone by construction.
//
// `lapsStmt` is passed in pre-prepared (matching the pattern in
// `importLapMonitorJson`) — we'd otherwise re-prepare it on every
// `setDriverPenalty` / `setVoidedLapsCount` call.
function recomputePlacements(
  db: Database.Database,
  raceId: string,
  lapsStmt: Database.Statement,
  setPlacementStmt: Database.Statement,
): void {
  const race = db
    .prepare(`SELECT race_kind FROM rc_races WHERE id = ?`)
    .get(raceId) as { race_kind: RaceKind } | undefined;
  if (!race) return;

  const drivers = db
    .prepare(
      `SELECT driver_id, laps_completed, best_lap_ms, total_time_ms,
              penalty_ms, voided_laps_count, transponder_id
         FROM rc_race_drivers
        WHERE race_id = ?`,
    )
    .all(raceId) as Array<{
    driver_id: string;
    laps_completed: number;
    best_lap_ms: number | null;
    total_time_ms: number;
    penalty_ms: number;
    voided_laps_count: number;
    transponder_id: number;
  }>;

  const inputs: PlacementInput[] = drivers.map((d) => {
    const lapRows = lapsStmt.all(raceId, d.driver_id) as Array<{ lap_time_ms: number }>;
    const normalAsc = lapRows.map((r) => r.lap_time_ms);
    return {
      driverId: d.driver_id,
      lapsCompleted: d.laps_completed,
      bestLapMs: d.best_lap_ms,
      totalTimeMs: d.total_time_ms,
      penaltyMs: d.penalty_ms,
      rankingLapsAscMs: rankingLapTimes(normalAsc, d.voided_laps_count),
      transponderId: d.transponder_id,
    };
  });
  inputs.sort((a, b) => comparePlacement(a, b, race.race_kind));

  for (let i = 0; i < inputs.length; i++) {
    setPlacementStmt.run(i + 1, raceId, inputs[i]!.driverId);
  }
}

export function setDriverPenalty(
  db: Database.Database,
  raceId: string,
  driverId: string,
  penaltyMs: number,
): { status: 'ok' } | { status: 'no_row' } | { status: 'invalid' } {
  if (!Number.isInteger(penaltyMs) || penaltyMs < 0) {
    return { status: 'invalid' };
  }
  const lapsStmt = db.prepare(
    `SELECT lap_time_ms FROM rc_laps
      WHERE race_id = ? AND driver_id = ? AND lap_kind = 'normal'
      ORDER BY lap_time_ms ASC`,
  );
  const setPlacementStmt = db.prepare(
    `UPDATE rc_race_drivers SET placement = ? WHERE race_id = ? AND driver_id = ?`,
  );
  const tx = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE rc_race_drivers SET penalty_ms = ? WHERE race_id = ? AND driver_id = ?`,
      )
      .run(penaltyMs, raceId, driverId);
    if (updated.changes === 0) return { status: 'no_row' as const };
    recomputePlacements(db, raceId, lapsStmt, setPlacementStmt);
    return { status: 'ok' as const };
  });
  return tx.immediate();
}

export function setVoidedLapsCount(
  db: Database.Database,
  raceId: string,
  driverId: string,
  count: number,
): { status: 'ok' } | { status: 'no_row' } | { status: 'invalid' } {
  if (!Number.isInteger(count) || count < 0) {
    return { status: 'invalid' };
  }
  const lapsStmt = db.prepare(
    `SELECT lap_time_ms FROM rc_laps
      WHERE race_id = ? AND driver_id = ? AND lap_kind = 'normal'
      ORDER BY lap_time_ms ASC`,
  );
  const setPlacementStmt = db.prepare(
    `UPDATE rc_race_drivers SET placement = ? WHERE race_id = ? AND driver_id = ?`,
  );
  const tx = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE rc_race_drivers SET voided_laps_count = ? WHERE race_id = ? AND driver_id = ?`,
      )
      .run(count, raceId, driverId);
    if (updated.changes === 0) return { status: 'no_row' as const };
    recomputePlacements(db, raceId, lapsStmt, setPlacementStmt);
    return { status: 'ok' as const };
  });
  return tx.immediate();
}

export function deleteRace(
  db: Database.Database,
  raceId: string,
): { status: 'ok' } | { status: 'no_row' } {
  // Cascade FKs on rc_race_drivers.race_id and rc_laps.race_id
  // (0003_rc_racing.sql:38,52) handle dependent rows automatically.
  const tx = db.transaction(() => {
    const result = db.prepare(`DELETE FROM rc_races WHERE id = ?`).run(raceId);
    if (result.changes === 0) return { status: 'no_row' as const };
    return { status: 'ok' as const };
  });
  return tx.immediate();
}

export function lapsForRace(db: Database.Database, raceId: string): RcLapRow[] {
  return db
    .prepare(
      `SELECT driver_id, lap_index, lap_number, lap_time_ms, end_timestamp_ms, lap_kind
         FROM rc_laps
        WHERE race_id = ?
        ORDER BY driver_id, lap_index`,
    )
    .all(raceId) as RcLapRow[];
}

export function bestLapsForTrack(
  db: Database.Database,
  trackId: string,
  limit = 50,
): RcDriverBestRow[] {
  return db
    .prepare(
      `SELECT d.id AS driver_id, d.display_name, d.player_id,
              MIN(l.lap_time_ms) AS lap_time_ms,
              r.id AS race_id, r.race_started_at, r.race_name
         FROM rc_laps l
         JOIN rc_races r   ON r.id = l.race_id
         JOIN rc_drivers d ON d.id = l.driver_id
        WHERE l.lap_kind = 'normal' AND r.track_id = ?
        GROUP BY d.id
        ORDER BY lap_time_ms ASC
        LIMIT ?`,
    )
    .all(trackId, limit) as RcDriverBestRow[];
}

export function getDriver(db: Database.Database, id: string): RcDriverRow | null {
  return (
    (db.prepare(`SELECT * FROM rc_drivers WHERE id = ?`).get(id) as RcDriverRow | undefined) ??
    null
  );
}

export function getDriverWithLinkedPlayer(
  db: Database.Database,
  driverId: string,
): RcDriverWithPlayerRow | null {
  return (
    (db
      .prepare(
        `SELECT d.id, d.lap_monitor_driver_uuid, d.display_name, d.player_id, d.created_at,
                p.display_name   AS linked_display_name,
                p.discord_handle AS linked_discord_handle,
                p.avatar_url     AS linked_avatar_url
           FROM rc_drivers d
           LEFT JOIN players p ON p.id = d.player_id
          WHERE d.id = ?`,
      )
      .get(driverId) as RcDriverWithPlayerRow | undefined) ?? null
  );
}

// Validate the FK in app code so the API surface returns a typed status
// instead of leaking SQLite's FOREIGN KEY error. Same .immediate() tx
// shape as setRaceTrack / setDriverPenalty / deleteRace.
export function setDriverPlayer(
  db: Database.Database,
  driverId: string,
  playerId: string | null,
): { status: 'ok' } | { status: 'no_driver' } | { status: 'no_player' } {
  const tx = db.transaction(() => {
    const driver = db.prepare(`SELECT id FROM rc_drivers WHERE id = ?`).get(driverId) as
      | { id: string }
      | undefined;
    if (!driver) return { status: 'no_driver' as const };

    if (playerId !== null) {
      const player = db.prepare(`SELECT id FROM players WHERE id = ?`).get(playerId) as
        | { id: string }
        | undefined;
      if (!player) return { status: 'no_player' as const };
    }

    db.prepare(`UPDATE rc_drivers SET player_id = ? WHERE id = ?`).run(playerId, driverId);
    return { status: 'ok' as const };
  });
  return tx.immediate();
}

export function listDrivers(db: Database.Database): RcDriverRow[] {
  return db.prepare(`SELECT * FROM rc_drivers ORDER BY display_name`).all() as RcDriverRow[];
}

export function recentRacesForDriver(
  db: Database.Database,
  driverId: string,
  limit = 50,
): RcDriverRecentRaceRow[] {
  return db
    .prepare(
      `SELECT r.id AS race_id, r.race_started_at, r.race_kind, r.race_name,
              t.name AS track_name, t.slug AS track_slug,
              rd.placement, rd.laps_completed, rd.best_lap_ms, rd.total_time_ms
         FROM rc_race_drivers rd
         JOIN rc_races r  ON r.id  = rd.race_id
         JOIN rc_tracks t ON t.id  = r.track_id
        WHERE rd.driver_id = ?
        ORDER BY r.race_started_at DESC
        LIMIT ?`,
    )
    .all(driverId, limit) as RcDriverRecentRaceRow[];
}

export function perTrackBestsForDriver(
  db: Database.Database,
  driverId: string,
): RcDriverPerTrackBestRow[] {
  return db
    .prepare(
      `SELECT t.id AS track_id, t.name AS track_name, t.slug AS track_slug,
              MIN(l.lap_time_ms) AS best_lap_ms
         FROM rc_laps l
         JOIN rc_races r  ON r.id = l.race_id
         JOIN rc_tracks t ON t.id = r.track_id
        WHERE l.lap_kind = 'normal' AND l.driver_id = ?
        GROUP BY t.id
        ORDER BY t.name`,
    )
    .all(driverId) as RcDriverPerTrackBestRow[];
}
