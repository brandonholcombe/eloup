import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import type { ImportResult, ImportSummary } from './import';

// TXT has no offset on the race date (the operator's TXT export writes
// "May 17, 2026 at 2:54:26 PM" with no zone label). We store the
// timestamp offset-less ("2026-05-17T14:54:26"); the rc/datetime helper
// renders it back verbatim, treating it as a floating local timestamp.

const RACE_KIND_BY_PREFIX: Record<string, 'race' | 'practice' | 'qualif'> = {
  race: 'race',
  practice: 'practice',
  qualif: 'qualif',
};

const MONTHS_BY_NAME: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const DATE_ROW_RE =
  /^(\w+)\s+(\w+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i;

const LAP_TIME_RE = /^(\d{1,2}):(\d{2})\.(\d{2})$/;

// Tolerant summary-table header detection: fixture has `| Laps  |`
// (two spaces) — a literal `| Laps |` match silently fails on real
// exports.
const SUMMARY_HEADER_RE = /\|\s*Laps\s*\|/i;

type ParsedLap = {
  kind: 'initial' | 'normal';
  lapTimeMs: number; // 0 for the initial cumulative-only lap
  endTimestampMs: number; // cumulative
  userIndex: number; // 0-indexed within driver section
};

type ParsedDriver = {
  name: string;
  laps: ParsedLap[];
};

type ParsedRace = {
  raceName: string;
  raceKind: 'race' | 'practice' | 'qualif';
  raceStartedAt: string; // offset-less ISO, e.g. "2026-05-17T14:54:26"
  drivers: ParsedDriver[];
};

type DriverStandings = {
  driverId: string;
  transponderId: number;
  lapsCompleted: number;
  bestLapMs: number | null;
  totalTimeMs: number;
};

// Lap Monitor TXT lap-time format: "MM:SS.HH" (HH = hundredths of a
// second). Returns null on malformed input — the importer treats this
// as whole-file-fatal.
export function parseLapTimeMs(s: string): number | null {
  const m = LAP_TIME_RE.exec(s.trim());
  if (!m) return null;
  const [, mins, secs, hh] = m;
  return Number(mins) * 60_000 + Number(secs) * 1000 + Number(hh) * 10;
}

// Normalize TXT for hashing: strip trailing whitespace per line, collapse
// blank-line runs to one, normalize \r\n → \n, strip leading/trailing
// blank lines. The hash is stable across these portability transforms but
// distinct for content changes.
export function normalizeForHash(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''));
  const out: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    const blank = line.length === 0;
    if (blank && prevBlank) continue;
    out.push(line);
    prevBlank = blank;
  }
  // Trim leading/trailing blank lines.
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

export function txtHash(text: string): string {
  return `txt:${createHash('sha1').update(normalizeForHash(text)).digest('hex')}`;
}

export function parseLapMonitorTxt(text: string): ParsedRace | { error: string } {
  const rawLines = text.split(/\r?\n/);
  // Strip trailing whitespace and trim leading/trailing blank lines.
  const trimmed = rawLines.map((l) => l.replace(/[ \t]+$/, ''));
  while (trimmed.length && trimmed[0]!.trim() === '') trimmed.shift();
  while (trimmed.length && trimmed[trimmed.length - 1]!.trim() === '') trimmed.pop();
  if (trimmed.length === 0) return { error: 'empty file' };

  let i = 0;
  const nextNonBlank = (): number => {
    while (i < trimmed.length && trimmed[i]!.trim() === '') i++;
    return i;
  };

  // 1) Header: race name.
  nextNonBlank();
  if (i >= trimmed.length) return { error: 'missing header line' };
  const raceName = trimmed[i]!.trim();
  i++;

  // 2) Date row.
  nextNonBlank();
  if (i >= trimmed.length) return { error: 'missing date row' };
  const dateLine = trimmed[i]!.trim();
  const dateMatch = DATE_ROW_RE.exec(dateLine);
  if (!dateMatch) return { error: `malformed date row: ${dateLine}` };
  const [, kindWord, monthWord, dayStr, yearStr, hourStr, minStr, secStr, ampm] = dateMatch;
  const kindLower = kindWord!.toLowerCase();
  const raceKind = RACE_KIND_BY_PREFIX[kindLower];
  if (!raceKind) return { error: `unknown race kind: ${kindWord}` };
  const monthNum = MONTHS_BY_NAME[monthWord!.toLowerCase()];
  if (!monthNum) return { error: `unknown month: ${monthWord}` };
  let hour24 = Number(hourStr);
  if (hour24 < 1 || hour24 > 12) return { error: `bad hour in date row: ${hourStr}` };
  const upperAmpm = ampm!.toUpperCase();
  if (upperAmpm === 'AM') {
    if (hour24 === 12) hour24 = 0;
  } else {
    if (hour24 !== 12) hour24 += 12;
  }
  const raceStartedAt =
    `${yearStr!.padStart(4, '0')}-${String(monthNum).padStart(2, '0')}-` +
    `${dayStr!.padStart(2, '0')}T${String(hour24).padStart(2, '0')}:` +
    `${minStr!.padStart(2, '0')}:${secStr!.padStart(2, '0')}`;
  i++;

  // 3) Skip the attribution line containing `lapmonitor.com`.
  nextNonBlank();
  if (i < trimmed.length && /lapmonitor\.com/i.test(trimmed[i]!)) {
    i++;
  }

  // 4) Skip the summary table: header line (regex tolerant), separator,
  //    data rows until blank.
  nextNonBlank();
  if (i < trimmed.length && SUMMARY_HEADER_RE.test(trimmed[i]!)) {
    i++; // header
    // separator line of `=`
    if (i < trimmed.length && /^=+$/.test(trimmed[i]!.trim())) i++;
    // data rows until blank line
    while (i < trimmed.length && trimmed[i]!.trim() !== '') i++;
  }

  // 5) Per-driver sections.
  const drivers: ParsedDriver[] = [];
  while (i < trimmed.length) {
    nextNonBlank();
    if (i >= trimmed.length) break;
    const headerLine = trimmed[i]!.trim();
    // Driver header: a non-`Lap`-prefixed line ending with `:`.
    if (!headerLine.endsWith(':') || /^Lap\s+\d+:/i.test(headerLine)) {
      return { error: `expected driver header, got: ${headerLine}` };
    }
    const name = headerLine.slice(0, -1).trim();
    if (name.length === 0) return { error: 'empty driver name' };
    i++;

    const laps: ParsedLap[] = [];
    let userIndex = 0;
    while (i < trimmed.length && trimmed[i]!.trim() !== '') {
      const line = trimmed[i]!.trim();
      // Initial lap: "Lap 0: <cumulative>" — no lap_time, only cumulative.
      // Normal lap:  "Lap N: <lap_time> <cumulative>".
      const initial = /^Lap\s+0:\s+([\d:.]+)$/i.exec(line);
      if (initial) {
        const endMs = parseLapTimeMs(initial[1]!);
        if (endMs == null) return { error: `malformed initial cumulative: ${line}` };
        laps.push({ kind: 'initial', lapTimeMs: 0, endTimestampMs: endMs, userIndex });
        userIndex++;
        i++;
        continue;
      }
      const normal = /^Lap\s+(\d+):\s+([\d:.]+)\s+([\d:.]+)$/i.exec(line);
      if (normal) {
        const lapMs = parseLapTimeMs(normal[2]!);
        const endMs = parseLapTimeMs(normal[3]!);
        if (lapMs == null || endMs == null) {
          return { error: `malformed lap times in: ${line}` };
        }
        laps.push({ kind: 'normal', lapTimeMs: lapMs, endTimestampMs: endMs, userIndex });
        userIndex++;
        i++;
        continue;
      }
      return { error: `malformed lap line: ${line}` };
    }

    if (laps.length === 0) {
      return { error: `empty driver section: ${name}` };
    }
    drivers.push({ name, laps });
  }

  if (drivers.length === 0) return { error: 'no driver sections' };

  return {
    raceName,
    raceKind,
    raceStartedAt,
    drivers,
  };
}

// Whole-file-fatal validation policy (mirrors importLapMonitorJson):
// any malformed input returns {status: 'invalid'} without inserting any
// rows.
export function importLapMonitorTxt(
  db: Database.Database,
  text: string,
  trackId: string,
  uploadedBy: string,
  now: () => string = () => new Date().toISOString(),
): ImportResult {
  if (text.trim().length === 0) {
    return { status: 'invalid', reason: 'empty file' };
  }
  const parsed = parseLapMonitorTxt(text);
  if ('error' in parsed) {
    return { status: 'invalid', reason: parsed.error };
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

  const fileUuid = txtHash(text);

  // Driver lookup: UUID match (synthetic txt-name:<lower>) wins over
  // case-insensitive display_name match (which catches a driver who
  // first appeared in a JSON import and is now appearing in a TXT). The
  // ORDER BY CASE ensures determinism when both branches could fire.
  const findDriver = db.prepare(
    `SELECT id, lap_monitor_driver_uuid FROM rc_drivers
      WHERE lap_monitor_driver_uuid = ?
         OR lower(display_name) = lower(?)
      ORDER BY CASE WHEN lap_monitor_driver_uuid = ? THEN 0 ELSE 1 END
      LIMIT 1`,
  );
  const insertDriver = db.prepare(
    `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name) VALUES (?, ?, ?)`,
  );
  const findRace = db.prepare(`SELECT id FROM rc_races WHERE lap_monitor_uuid = ?`);
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
    totalRaces: 1,
    insertedRaces: 0,
    duplicateRaces: 0,
    driversCreated: 0,
    driversReused: 0,
    lapsImported: 0,
  };
  const raceIds: string[] = [];
  const nowIso = now();

  const tx = db.transaction(() => {
    const existing = findRace.get(fileUuid) as { id: string } | undefined;
    if (existing) {
      summary.duplicateRaces++;
      return;
    }

    const driverIdByName = new Map<string, string>();
    const standingsByDriverId = new Map<string, DriverStandings>();
    for (const driver of parsed.drivers) {
      const driverId = upsertTxtDriver(driver.name, findDriver, insertDriver, summary);
      driverIdByName.set(driver.name, driverId);
      standingsByDriverId.set(driverId, computeTxtStandings(driverId, driver));
    }

    const sorted = [...standingsByDriverId.values()].sort(comparePlacement);
    const raceId = randomUUID();
    insertRace.run(
      raceId,
      fileUuid,
      trackId,
      parsed.raceStartedAt,
      parsed.raceKind,
      parsed.raceName,
      null, // duration_seconds — TXT doesn't expose duration; null is the sentinel
      text, // source_blob = raw TXT, mirroring JSON.stringify(race) on the JSON path
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

    for (const driver of parsed.drivers) {
      const driverId = driverIdByName.get(driver.name)!;
      for (let i = 0; i < driver.laps.length; i++) {
        const lap = driver.laps[i]!;
        insertLap.run(
          raceId,
          driverId,
          i,
          lap.userIndex,
          lap.lapTimeMs,
          lap.endTimestampMs,
          lap.kind,
        );
        summary.lapsImported++;
      }
    }

    summary.insertedRaces++;
    raceIds.push(raceId);
  });
  tx.immediate();

  return { status: 'ok', summary, raceIds };
}

function upsertTxtDriver(
  name: string,
  findStmt: Database.Statement,
  insertStmt: Database.Statement,
  summary: ImportSummary,
): string {
  const synthetic = `txt-name:${name.toLowerCase().trim()}`;
  // Bind synthetic UUID twice: WHERE + ORDER BY CASE.
  const existing = findStmt.get(synthetic, name, synthetic) as
    | { id: string; lap_monitor_driver_uuid: string }
    | undefined;
  if (existing) {
    summary.driversReused++;
    return existing.id;
  }
  const id = randomUUID();
  insertStmt.run(id, synthetic, name);
  summary.driversCreated++;
  return id;
}

// Transponder is 0 for every TXT-imported driver (the format doesn't
// expose it). Tiebreak falls to insert order, which matches the TXT's
// own summary-table ordering.
function computeTxtStandings(driverId: string, driver: ParsedDriver): DriverStandings {
  let lapsCompleted = 0;
  let bestLapMs: number | null = null;
  let totalTimeMs = 0;
  for (const lap of driver.laps) {
    if (lap.kind === 'normal') {
      lapsCompleted++;
      if (bestLapMs === null || lap.lapTimeMs < bestLapMs) bestLapMs = lap.lapTimeMs;
      if (lap.endTimestampMs > totalTimeMs) totalTimeMs = lap.endTimestampMs;
    }
  }
  return {
    driverId,
    transponderId: 0,
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
