import type Database from 'better-sqlite3';

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
              rd.laps_completed, rd.best_lap_ms, rd.total_time_ms
         FROM rc_race_drivers rd
         JOIN rc_drivers d ON d.id = rd.driver_id
        WHERE rd.race_id = ?
        ORDER BY rd.placement`,
    )
    .all(raceId) as RcStandingRow[];
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
