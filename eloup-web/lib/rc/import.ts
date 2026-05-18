import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';

// Lap Monitor encodes lap durations and endTimestamps as integer centiseconds
// (1/100 second), not milliseconds. RC racing laps are typically 17-30 seconds;
// a "duration: 2171" lap is 21.71s, not 2.171s. The DB columns are named
// *_ms by contract, so we scale on the way in.
const LAP_MONITOR_CS_TO_MS = 10;

const LapSchema = z.object({
  kind: z.enum(['initial', 'normal', 'ignored']),
  duration: z.number().int().min(0),
  endTimestamp: z.number().int().min(0),
  userIndex: z.number().int(),
});

const DriverSchema = z.object({
  driverUuid: z.string().min(1),
  name: z.string().min(1),
  transponderId: z.number().int(),
  kind: z.literal('driver'),
  laps: z.array(LapSchema),
});

const RaceSchema = z.object({
  uuid: z.string().min(1),
  date: z.string().min(1),
  duration: z.number().int().min(0).optional(),
  kind: z.enum(['qualif', 'practice', 'race']),
  name: z.string().optional(),
  drivers: z.array(DriverSchema).min(1),
});

const FileSchema = z.object({
  races: z.array(RaceSchema).min(1),
});

export type ImportSummary = {
  totalRaces: number;
  insertedRaces: number;
  duplicateRaces: number;
  driversCreated: number;
  driversReused: number;
  lapsImported: number;
};

export type ImportResult =
  | { status: 'ok'; summary: ImportSummary; raceIds: string[] }
  | { status: 'invalid'; reason: string };

type DriverRow = z.infer<typeof DriverSchema>;
type RaceRow = z.infer<typeof RaceSchema>;

type DriverStandings = {
  driverId: string;
  transponderId: number;
  lapsCompleted: number;
  bestLapMs: number | null;
  totalTimeMs: number;
};

// Whole-file-fatal validation policy (Phase B): any malformed race kills the
// entire upload — see r1-rc-racing-dashboard.md §"Resolved review notes" #2.
export function importLapMonitorJson(
  db: Database.Database,
  json: unknown,
  trackId: string,
  uploadedBy: string,
  now: () => string = () => new Date().toISOString(),
): ImportResult {
  const parsed = FileSchema.safeParse(json);
  if (!parsed.success) {
    return { status: 'invalid', reason: formatZodError(parsed.error) };
  }

  const trackRow = db
    .prepare(`SELECT id FROM rc_tracks WHERE id = ?`)
    .get(trackId) as { id: string } | undefined;
  if (!trackRow) return { status: 'invalid', reason: `unknown trackId: ${trackId}` };

  const uploaderRow = db
    .prepare(`SELECT id FROM players WHERE id = ?`)
    .get(uploadedBy) as { id: string } | undefined;
  if (!uploaderRow) {
    return { status: 'invalid', reason: `unknown uploadedBy: ${uploadedBy}` };
  }

  const findRace = db.prepare(`SELECT id FROM rc_races WHERE lap_monitor_uuid = ?`);
  const findDriver = db.prepare(
    `SELECT id FROM rc_drivers WHERE lap_monitor_driver_uuid = ?`,
  );
  // Conditional fallback: only used when the UUID lookup misses. Matches
  // by case-insensitive display_name BUT ONLY when the existing row's
  // lap_monitor_driver_uuid starts with `txt-name:` (i.e. the row was
  // created by a TXT import and has no real Lap Monitor UUID yet). This
  // preserves the JSON-only invariant that two distinct JSON drivers
  // with the same first name stay distinct.
  const findDriverByTxtName = db.prepare(
    `SELECT id FROM rc_drivers
      WHERE lower(display_name) = lower(?)
        AND lap_monitor_driver_uuid LIKE 'txt-name:%'
      LIMIT 1`,
  );
  const insertDriver = db.prepare(
    `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES (?, ?, ?)`,
  );
  const updateDriverName = db.prepare(
    `UPDATE rc_drivers SET display_name = ? WHERE id = ? AND display_name != ?`,
  );
  const insertRace = db.prepare(
    `INSERT INTO rc_races(id, lap_monitor_uuid, track_id, race_started_at, race_kind,
                          race_name, duration_seconds, source_blob, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRaceDriver = db.prepare(
    `INSERT INTO rc_race_drivers(race_id, driver_id, transponder_id, placement,
                                 laps_completed, best_lap_ms, total_time_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLap = db.prepare(
    `INSERT INTO rc_laps(race_id, driver_id, lap_index, lap_number,
                         lap_time_ms, end_timestamp_ms, lap_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const summary: ImportSummary = {
    totalRaces: parsed.data.races.length,
    insertedRaces: 0,
    duplicateRaces: 0,
    driversCreated: 0,
    driversReused: 0,
    lapsImported: 0,
  };
  const raceIds: string[] = [];
  const nowIso = now();

  const tx = db.transaction(() => {
    const driverIdByUuid = new Map<string, string>();

    for (const race of parsed.data.races) {
      const existing = findRace.get(race.uuid) as { id: string } | undefined;
      if (existing) {
        summary.duplicateRaces++;
        continue;
      }

      const standingsByDriverId = new Map<string, DriverStandings>();
      for (const driver of race.drivers) {
        const driverId = upsertDriver(
          driver,
          driverIdByUuid,
          findDriver,
          findDriverByTxtName,
          insertDriver,
          updateDriverName,
          summary,
        );
        standingsByDriverId.set(driverId, computeStandings(driverId, driver));
      }

      const sorted = [...standingsByDriverId.values()].sort(comparePlacement);
      const raceId = randomUUID();
      insertRace.run(
        raceId,
        race.uuid,
        trackId,
        race.date,
        race.kind,
        race.name ?? null,
        race.duration ?? null,
        JSON.stringify(race),
        uploadedBy,
        nowIso,
      );

      for (let placement = 0; placement < sorted.length; placement++) {
        const s = sorted[placement]!;
        insertRaceDriver.run(
          raceId,
          s.driverId,
          s.transponderId,
          placement + 1,
          s.lapsCompleted,
          s.bestLapMs,
          s.totalTimeMs,
        );
      }

      for (const driver of race.drivers) {
        const driverId = driverIdByUuid.get(driver.driverUuid)!;
        for (let i = 0; i < driver.laps.length; i++) {
          const lap = driver.laps[i]!;
          insertLap.run(
            raceId,
            driverId,
            i,
            lap.userIndex,
            lap.duration * LAP_MONITOR_CS_TO_MS,
            lap.endTimestamp * LAP_MONITOR_CS_TO_MS,
            lap.kind,
          );
          summary.lapsImported++;
        }
      }

      summary.insertedRaces++;
      raceIds.push(raceId);
    }
  });
  tx.immediate();

  return { status: 'ok', summary, raceIds };
}

function upsertDriver(
  driver: DriverRow,
  cache: Map<string, string>,
  findStmt: Database.Statement,
  findByTxtNameStmt: Database.Statement,
  insertStmt: Database.Statement,
  updateNameStmt: Database.Statement,
  summary: ImportSummary,
): string {
  const cached = cache.get(driver.driverUuid);
  if (cached) {
    updateNameStmt.run(driver.name, cached, driver.name);
    return cached;
  }
  const existing = findStmt.get(driver.driverUuid) as { id: string } | undefined;
  if (existing) {
    updateNameStmt.run(driver.name, existing.id, driver.name);
    cache.set(driver.driverUuid, existing.id);
    summary.driversReused++;
    return existing.id;
  }
  // Conditional fallback: a row exists for this driver name that was
  // created by a TXT import (lap_monitor_driver_uuid LIKE 'txt-name:%').
  // Reuse it. The real Lap Monitor UUID is NOT backfilled — see
  // Hand-offs in h3-time-fix-and-txt-import.md.
  const txtNamed = findByTxtNameStmt.get(driver.name) as { id: string } | undefined;
  if (txtNamed) {
    updateNameStmt.run(driver.name, txtNamed.id, driver.name);
    cache.set(driver.driverUuid, txtNamed.id);
    summary.driversReused++;
    return txtNamed.id;
  }
  const id = randomUUID();
  insertStmt.run(id, driver.driverUuid, driver.name);
  cache.set(driver.driverUuid, id);
  summary.driversCreated++;
  return id;
}

function computeStandings(driverId: string, driver: DriverRow): DriverStandings {
  let lapsCompleted = 0;
  let bestLapMs: number | null = null;
  let totalTimeMs = 0;
  for (const lap of driver.laps) {
    const lapMs = lap.duration * LAP_MONITOR_CS_TO_MS;
    const endMs = lap.endTimestamp * LAP_MONITOR_CS_TO_MS;
    if (lap.kind === 'normal') {
      lapsCompleted++;
      if (bestLapMs === null || lapMs < bestLapMs) bestLapMs = lapMs;
    }
    if (lap.kind === 'normal' || lap.kind === 'ignored') {
      if (endMs > totalTimeMs) totalTimeMs = endMs;
    }
  }
  return {
    driverId,
    transponderId: driver.transponderId,
    lapsCompleted,
    bestLapMs,
    totalTimeMs,
  };
}

function comparePlacement(a: DriverStandings, b: DriverStandings): number {
  if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
  if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
  return a.transponderId - b.transponderId;
}

function formatZodError(err: z.ZodError): string {
  const issues = err.issues.slice(0, 5).map((i) => {
    const path = i.path.length ? i.path.join('.') : '(root)';
    return `${path}: ${i.message}`;
  });
  return issues.join('; ');
}
