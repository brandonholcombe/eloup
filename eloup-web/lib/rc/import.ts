import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';

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
            lap.duration,
            lap.endTimestamp,
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
    if (lap.kind === 'normal') {
      lapsCompleted++;
      if (bestLapMs === null || lap.duration < bestLapMs) bestLapMs = lap.duration;
    }
    if (lap.kind === 'normal' || lap.kind === 'ignored') {
      if (lap.endTimestamp > totalTimeMs) totalTimeMs = lap.endTimestamp;
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
