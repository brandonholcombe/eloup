import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { importLapMonitorJson } from '@/lib/rc/import';

const FIXTURE_PATH = join(__dirname, '..', '..', '..', 'Agents', 'fixtures', 'lap-monitor-sample.json');

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-rc-import-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedUploader(db: Database.Database, id = 'admin') {
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES (?, ?, ?, ?, 'global_admin')`,
  ).run(id, id, id, id);
  return id;
}

function seedTrack(db: Database.Database, id = 'track-a', name = 'Track A') {
  db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES (?, ?, ?)`).run(id, name, id);
  return id;
}

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

describe('importLapMonitorJson — happy path against the real fixture', () => {
  it('imports the 15-race fixture and populates every rc_* table', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const json = loadFixture();

    const result = importLapMonitorJson(db, json, trackId, uploader);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.summary.totalRaces).toBe(15);
    expect(result.summary.insertedRaces).toBe(15);
    expect(result.summary.duplicateRaces).toBe(0);
    expect(result.summary.driversCreated).toBe(2);
    expect(result.summary.driversReused).toBe(0);
    expect(result.summary.lapsImported).toBeGreaterThan(0);

    const raceCount = db.prepare(`SELECT COUNT(*) AS n FROM rc_races`).get() as { n: number };
    expect(raceCount.n).toBe(15);

    const driverCount = db.prepare(`SELECT COUNT(*) AS n FROM rc_drivers`).get() as { n: number };
    expect(driverCount.n).toBe(2);

    const standingCount = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers`)
      .get() as { n: number };
    expect(standingCount.n).toBe(30);

    // Fresh imports must default penalty_ms to 0 on every row.
    const nonZeroPenalties = db
      .prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers WHERE penalty_ms != 0`)
      .get() as { n: number };
    expect(nonZeroPenalties.n).toBe(0);
  });

  it('race-kind placement: (laps DESC, total_time_ms ASC, transponder ASC)', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    importLapMonitorJson(db, loadFixture(), trackId, uploader);

    // After H6, the placement-ordering invariant differs by race_kind.
    // For `race` kind: laps DESC, adjusted-total ASC. For qualif/practice
    // the standings are top-3-avg ranked (asserted in a sibling test).
    const rows = db
      .prepare(
        `SELECT r.race_name, r.race_kind, d.display_name, rd.placement,
                rd.laps_completed, rd.total_time_ms, rd.transponder_id
           FROM rc_race_drivers rd
           JOIN rc_races r   ON r.id = rd.race_id
           JOIN rc_drivers d ON d.id = rd.driver_id
          WHERE r.race_kind = 'race'
          ORDER BY r.race_name, rd.placement`,
      )
      .all() as {
      race_name: string;
      race_kind: string;
      display_name: string;
      placement: number;
      laps_completed: number;
      total_time_ms: number;
      transponder_id: number;
    }[];

    const byRace = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byRace.get(r.race_name) ?? [];
      arr.push(r);
      byRace.set(r.race_name, arr);
    }
    expect(byRace.size).toBeGreaterThan(0);
    for (const [name, race] of byRace) {
      for (let i = 1; i < race.length; i++) {
        const a = race[i - 1]!;
        const b = race[i]!;
        const ok =
          a.laps_completed > b.laps_completed ||
          (a.laps_completed === b.laps_completed && a.total_time_ms <= b.total_time_ms);
        expect(ok, `${name}: placement #${a.placement} should beat #${b.placement}`).toBe(true);
      }
    }
  });

  it('qualif/practice placement: top-3-avg ASC of normal laps', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    importLapMonitorJson(db, loadFixture(), trackId, uploader);

    // For each qualif/practice race, the leader (placement 1) must have
    // top-3-avg <= every subsequent placement's top-3-avg (when both have
    // ≥ 3 normal laps). Drivers with <3 normal laps sink to the bottom.
    const races = db
      .prepare(
        `SELECT id, race_name, race_kind FROM rc_races
          WHERE race_kind IN ('qualif','practice')`,
      )
      .all() as { id: string; race_name: string; race_kind: string }[];
    expect(races.length).toBeGreaterThan(0);

    for (const r of races) {
      const standings = db
        .prepare(
          `SELECT rd.driver_id, rd.placement, rd.laps_completed
             FROM rc_race_drivers rd
            WHERE rd.race_id = ?
            ORDER BY rd.placement`,
        )
        .all(r.id) as { driver_id: string; placement: number; laps_completed: number }[];
      const top3ByDriver = new Map<string, number | null>();
      for (const s of standings) {
        const laps = db
          .prepare(
            `SELECT lap_time_ms FROM rc_laps
              WHERE race_id = ? AND driver_id = ? AND lap_kind = 'normal'
              ORDER BY lap_time_ms ASC LIMIT 3`,
          )
          .all(r.id, s.driver_id) as { lap_time_ms: number }[];
        top3ByDriver.set(
          s.driver_id,
          laps.length >= 3 ? (laps[0]!.lap_time_ms + laps[1]!.lap_time_ms + laps[2]!.lap_time_ms) / 3 : null,
        );
      }
      for (let i = 1; i < standings.length; i++) {
        const a = standings[i - 1]!;
        const b = standings[i]!;
        const aT = top3ByDriver.get(a.driver_id);
        const bT = top3ByDriver.get(b.driver_id);
        if (aT == null && bT == null) continue;
        if (aT == null) {
          // a has <3 laps but b doesn't? a must be after — impossible here.
          throw new Error(`${r.race_name}: <3-lap driver ranked above 3+-lap driver`);
        }
        if (bT == null) continue; // a has ≥3, b has <3 — a wins by sink rule.
        expect(aT, `${r.race_name}: placement ${a.placement} (${aT}) <= ${b.placement} (${bT})`).toBeLessThanOrEqual(bT);
      }
    }
  });

  it('best_lap_ms equals min(duration) over normal laps for each (race, driver)', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    importLapMonitorJson(db, loadFixture(), trackId, uploader);

    const mismatches = db
      .prepare(
        `SELECT rd.race_id, rd.driver_id, rd.best_lap_ms, MIN(l.lap_time_ms) AS expected
           FROM rc_race_drivers rd
           JOIN rc_laps l
             ON l.race_id = rd.race_id
            AND l.driver_id = rd.driver_id
            AND l.lap_kind = 'normal'
          GROUP BY rd.race_id, rd.driver_id
         HAVING rd.best_lap_ms IS NOT expected`,
      )
      .all() as { race_id: string; driver_id: string }[];
    expect(mismatches).toEqual([]);
  });

  it('initial laps preserve their non-zero endTimestamp (must not be clamped)', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    importLapMonitorJson(db, loadFixture(), trackId, uploader);

    const finalRace = db
      .prepare(
        `SELECT r.id FROM rc_races r
          WHERE r.lap_monitor_uuid = 'E42AD956-F439-4F44-BF75-8D726897F8A0'`,
      )
      .get() as { id: string };
    expect(finalRace).toBeTruthy();

    const initials = db
      .prepare(
        `SELECT d.display_name, l.end_timestamp_ms
           FROM rc_laps l
           JOIN rc_drivers d ON d.id = l.driver_id
          WHERE l.race_id = ? AND l.lap_kind = 'initial'
          ORDER BY d.display_name`,
      )
      .all(finalRace.id) as { display_name: string; end_timestamp_ms: number }[];

    const brandon = initials.find((r) => r.display_name === 'Brandon');
    const willy = initials.find((r) => r.display_name === 'Willy');
    // Stored as centiseconds × 10 → milliseconds; JSON had 16.5 and 0.2 cs.
    expect(brandon?.end_timestamp_ms).toBe(1650);
    expect(willy?.end_timestamp_ms).toBe(20);
  });
});

describe('importLapMonitorJson — idempotency', () => {
  it('re-uploading the same JSON inserts zero new rows', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const json = loadFixture();

    const first = importLapMonitorJson(db, json, trackId, uploader);
    expect(first.status).toBe('ok');

    const before = countAll(db);
    const second = importLapMonitorJson(db, json, trackId, uploader);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.summary.insertedRaces).toBe(0);
    expect(second.summary.duplicateRaces).toBe(15);
    // Duplicate races short-circuit before the driver loop runs, so
    // driversReused stays 0 even though every driver already exists.
    expect(second.summary.driversReused).toBe(0);
    expect(countAll(db)).toEqual(before);
  });

  it('re-uploading to a DIFFERENT track still rejects every race (uuid is globally unique)', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackA = seedTrack(db, 'track-a', 'Track A');
    const trackB = seedTrack(db, 'track-b', 'Track B');
    const json = loadFixture();

    importLapMonitorJson(db, json, trackA, uploader);
    const before = countAll(db);
    const second = importLapMonitorJson(db, json, trackB, uploader);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.summary.insertedRaces).toBe(0);
    expect(second.summary.duplicateRaces).toBe(15);
    expect(countAll(db)).toEqual(before);
  });

  it('updates driver display_name on re-import without creating duplicates', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const first = loadFixture() as { races: unknown[] };
    importLapMonitorJson(db, first, trackId, uploader);

    const renamed = JSON.parse(JSON.stringify(first)) as {
      races: { uuid: string; drivers: { name: string; driverUuid: string }[] }[];
    };
    const NEW_UUID = '00000000-0000-0000-0000-000000000001';
    renamed.races[0]!.uuid = NEW_UUID;
    for (const d of renamed.races[0]!.drivers) {
      if (d.name === 'Brandon') d.name = 'Brandon (renamed)';
    }
    const result = importLapMonitorJson(db, renamed, trackId, uploader);
    expect(result.status).toBe('ok');

    const drivers = db.prepare(`SELECT display_name FROM rc_drivers ORDER BY display_name`).all() as {
      display_name: string;
    }[];
    expect(drivers.map((d) => d.display_name).sort()).toEqual(['Brandon (renamed)', 'Willy']);
  });
});

describe('importLapMonitorJson — whole-file-fatal validation', () => {
  it('missing races key → invalid, no rows written', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const result = importLapMonitorJson(db, { deviceName: 'iPhone' }, trackId, uploader);
    expect(result.status).toBe('invalid');
    expect((db.prepare(`SELECT COUNT(*) AS n FROM rc_races`).get() as { n: number }).n).toBe(0);
  });

  it('race with no drivers → invalid, no rows written', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const result = importLapMonitorJson(
      db,
      {
        races: [
          {
            uuid: 'r1',
            date: '2026-05-01T00:00:00Z',
            kind: 'race',
            duration: 300,
            drivers: [],
          },
        ],
      },
      trackId,
      uploader,
    );
    expect(result.status).toBe('invalid');
  });

  it('one bad race in a 15-race batch → ZERO rows land across all rc_* tables', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const json = loadFixture() as { races: { kind: string }[] };
    json.races[7]!.kind = 'unknown';
    const result = importLapMonitorJson(db, json, trackId, uploader);
    expect(result.status).toBe('invalid');
    expect(countAll(db)).toEqual({ races: 0, drivers: 0, raceDrivers: 0, laps: 0 });
  });

  it('unknown trackId → invalid', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const result = importLapMonitorJson(db, loadFixture(), 'nope', uploader);
    expect(result.status).toBe('invalid');
  });

  it('lap_time_ms = JSON duration × 10 (Lap Monitor reports centiseconds)', () => {
    // Magnitude regression guard. The invariant tests above (best_lap_ms ==
    // MIN(lap_time_ms), placement ordering) would still pass even if every
    // value were off by a constant factor — those checks are scale-invariant.
    // This test pins the absolute conversion: a JSON duration of 2171cs must
    // store as 21710ms, NOT 2171ms. RC racing laps are 17-30s; the wrong
    // factor produced 2-3s laps in the first prod upload.
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const fixture = loadFixture() as {
      races: Array<{
        uuid: string;
        drivers: Array<{
          driverUuid: string;
          name: string;
          laps: Array<{ duration: number; endTimestamp: number; kind: string }>;
        }>;
      }>;
    };
    importLapMonitorJson(db, fixture, trackId, uploader);

    // Pin a specific (race, driver, lap_index) → stored ms equals JSON cs × 10.
    const firstRace = fixture.races[0]!;
    const firstDriver = firstRace.drivers[0]!;
    const firstNormalIdx = firstDriver.laps.findIndex((l) => l.kind === 'normal');
    expect(firstNormalIdx).toBeGreaterThanOrEqual(0);
    const jsonLap = firstDriver.laps[firstNormalIdx]!;

    const stored = db
      .prepare(
        `SELECT l.lap_time_ms, l.end_timestamp_ms
           FROM rc_laps l
           JOIN rc_races r   ON r.id = l.race_id
           JOIN rc_drivers d ON d.id = l.driver_id
          WHERE r.lap_monitor_uuid = ?
            AND d.lap_monitor_driver_uuid = ?
            AND l.lap_index = ?`,
      )
      .get(firstRace.uuid, firstDriver.driverUuid, firstNormalIdx) as
      | { lap_time_ms: number; end_timestamp_ms: number }
      | undefined;
    expect(stored).toBeDefined();
    expect(stored!.lap_time_ms).toBe(jsonLap.duration * 10);
    expect(stored!.end_timestamp_ms).toBe(jsonLap.endTimestamp * 10);

    // Sanity-check that the overall magnitude is plausible for RC racing (10-60s).
    const stats = db
      .prepare(
        `SELECT AVG(lap_time_ms) AS avg, MIN(lap_time_ms) AS min
           FROM rc_laps WHERE lap_kind = 'normal'`,
      )
      .get() as { avg: number; min: number };
    expect(stats.avg).toBeGreaterThan(10_000); // > 10s average rules out off-by-10 again
    expect(stats.min).toBeGreaterThan(5_000); // > 5s shortest plausible RC lap
  });
});

function countAll(db: Database.Database) {
  return {
    races: (db.prepare(`SELECT COUNT(*) AS n FROM rc_races`).get() as { n: number }).n,
    drivers: (db.prepare(`SELECT COUNT(*) AS n FROM rc_drivers`).get() as { n: number }).n,
    raceDrivers: (
      db.prepare(`SELECT COUNT(*) AS n FROM rc_race_drivers`).get() as { n: number }
    ).n,
    laps: (db.prepare(`SELECT COUNT(*) AS n FROM rc_laps`).get() as { n: number }).n,
  };
}
