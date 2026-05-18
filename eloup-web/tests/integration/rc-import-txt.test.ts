import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { importLapMonitorJson } from '@/lib/rc/import';
import { importLapMonitorTxt } from '@/lib/rc/import-txt';

const TXT_FIXTURE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'Agents',
  'fixtures',
  'lap-monitor-sample.txt',
);
const JSON_FIXTURE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'Agents',
  'fixtures',
  'lap-monitor-sample.json',
);

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-rc-import-txt-'));
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

function loadTxtFixture(): string {
  return readFileSync(TXT_FIXTURE_PATH, 'utf8');
}

function loadJsonFixture(): unknown {
  return JSON.parse(readFileSync(JSON_FIXTURE_PATH, 'utf8'));
}

describe('importLapMonitorTxt — full fixture round-trip', () => {
  it('inserts one race, two drivers, 42 laps with correct magnitudes', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const txt = loadTxtFixture();

    const result = importLapMonitorTxt(db, txt, trackId, uploader);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.summary).toEqual({
      totalRaces: 1,
      insertedRaces: 1,
      duplicateRaces: 0,
      driversCreated: 2,
      driversReused: 0,
      lapsImported: 42,
    });

    const races = db.prepare(`SELECT * FROM rc_races`).all() as Array<{
      race_name: string;
      race_kind: string;
      race_started_at: string;
      duration_seconds: number | null;
      lap_monitor_uuid: string;
      source_blob: string;
    }>;
    expect(races).toHaveLength(1);
    expect(races[0]!.race_name).toBe('R2');
    expect(races[0]!.race_kind).toBe('race');
    expect(races[0]!.race_started_at).toBe('2026-05-17T14:54:26');
    expect(races[0]!.duration_seconds).toBeNull();
    expect(races[0]!.lap_monitor_uuid).toMatch(/^txt:[0-9a-f]{40}$/);
    expect(races[0]!.source_blob).toBe(txt);

    const drivers = db
      .prepare(`SELECT * FROM rc_drivers ORDER BY display_name`)
      .all() as Array<{ display_name: string; lap_monitor_driver_uuid: string }>;
    expect(drivers).toHaveLength(2);
    expect(drivers.map((d) => d.display_name).sort()).toEqual(['Brandon', 'Sean']);
    for (const d of drivers) {
      expect(d.lap_monitor_driver_uuid).toMatch(/^txt-name:/);
    }

    const laps = db.prepare(`SELECT COUNT(*) AS n FROM rc_laps`).get() as { n: number };
    expect(laps.n).toBe(42);

    // Spot-check magnitudes from the fixture.
    const seanRow = drivers.find((d) => d.display_name === 'Sean')!;
    const brandonRow = drivers.find((d) => d.display_name === 'Brandon')!;
    const seanIdRow = db
      .prepare(`SELECT id FROM rc_drivers WHERE display_name = ?`)
      .get('Sean') as { id: string };
    const brandonIdRow = db
      .prepare(`SELECT id FROM rc_drivers WHERE display_name = ?`)
      .get('Brandon') as { id: string };
    expect(seanRow.lap_monitor_driver_uuid).toBe('txt-name:sean');
    expect(brandonRow.lap_monitor_driver_uuid).toBe('txt-name:brandon');

    const seanLap1 = db
      .prepare(`SELECT lap_time_ms FROM rc_laps WHERE driver_id = ? AND lap_index = 1`)
      .get(seanIdRow.id) as { lap_time_ms: number };
    expect(seanLap1.lap_time_ms).toBe(15230);

    const brandonLap15 = db
      .prepare(`SELECT lap_time_ms FROM rc_laps WHERE driver_id = ? AND lap_index = 15`)
      .get(brandonIdRow.id) as { lap_time_ms: number };
    expect(brandonLap15.lap_time_ms).toBe(28960);
  });

  it('re-uploading the same fixture returns duplicateRaces=1 with no new rows', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const txt = loadTxtFixture();

    const first = importLapMonitorTxt(db, txt, trackId, uploader);
    expect(first.status).toBe('ok');
    const second = importLapMonitorTxt(db, txt, trackId, uploader);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.summary.insertedRaces).toBe(0);
    expect(second.summary.duplicateRaces).toBe(1);

    const races = db.prepare(`SELECT COUNT(*) AS n FROM rc_races`).get() as { n: number };
    expect(races.n).toBe(1);
    const laps = db.prepare(`SELECT COUNT(*) AS n FROM rc_laps`).get() as { n: number };
    expect(laps.n).toBe(42);
  });

  it('idempotent across \\r\\n line endings (same content-hash)', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const txt = loadTxtFixture();

    const first = importLapMonitorTxt(db, txt, trackId, uploader);
    expect(first.status).toBe('ok');
    const crlf = txt.replace(/\n/g, '\r\n');
    const second = importLapMonitorTxt(db, crlf, trackId, uploader);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.summary.duplicateRaces).toBe(1);
  });
});

describe('importLapMonitorTxt — standings derivation', () => {
  it('Sean wins (placement 1) on total_time_ms tiebreak with equal laps', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const result = importLapMonitorTxt(db, loadTxtFixture(), trackId, uploader);
    expect(result.status).toBe('ok');

    const standings = db
      .prepare(
        `SELECT d.display_name, rd.placement, rd.laps_completed, rd.total_time_ms
           FROM rc_race_drivers rd
           JOIN rc_drivers d ON d.id = rd.driver_id
          ORDER BY rd.placement`,
      )
      .all() as Array<{
      display_name: string;
      placement: number;
      laps_completed: number;
      total_time_ms: number;
    }>;
    expect(standings).toHaveLength(2);
    expect(standings[0]!.display_name).toBe('Sean');
    expect(standings[0]!.placement).toBe(1);
    expect(standings[0]!.laps_completed).toBe(20);
    expect(standings[1]!.display_name).toBe('Brandon');
    expect(standings[1]!.placement).toBe(2);
    expect(standings[1]!.laps_completed).toBe(20);
    // Sean's total time < Brandon's (5:00.47 vs 5:10.70).
    expect(standings[0]!.total_time_ms).toBeLessThan(standings[1]!.total_time_ms);
  });
});

describe('importLapMonitorTxt — whole-file-fatal', () => {
  it('returns invalid and inserts no rows on a malformed lap line', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);
    const broken =
      'R2\n\nRace    May 17, 2026 at 2:54:26 PM\n\nSean:\n' +
      'Lap 0: 0:07.41\n' +
      'Lap 1: BAD 0:22.64\n';
    const result = importLapMonitorTxt(db, broken, trackId, uploader);
    expect(result.status).toBe('invalid');

    const races = db.prepare(`SELECT COUNT(*) AS n FROM rc_races`).get() as { n: number };
    const drivers = db.prepare(`SELECT COUNT(*) AS n FROM rc_drivers`).get() as { n: number };
    expect(races.n).toBe(0);
    expect(drivers.n).toBe(0);
  });

  it('returns invalid when trackId is unknown', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const result = importLapMonitorTxt(db, loadTxtFixture(), 'no-such-track', uploader);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.reason).toMatch(/unknown trackId/);
  });
});

describe('cross-format driver dedup', () => {
  it('JSON-then-TXT: TXT name match reuses the existing real-UUID row (one Brandon)', () => {
    // The TXT-side OR-query has no LIKE 'txt-name:%' guard — it matches
    // any display_name. So a JSON-then-TXT flow correctly reuses the
    // JSON-created row (which has a real UUID) for the TXT's "Brandon".
    // The TXT-then-JSON direction is the asymmetric case: the JSON
    // importer applies a CONDITIONAL fallback (only reuses txt-name:%
    // rows) to keep two distinct JSON Brandons distinct.
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);

    const jsonResult = importLapMonitorJson(db, loadJsonFixture(), trackId, uploader);
    expect(jsonResult.status).toBe('ok');

    const jsonBrandon = db
      .prepare(`SELECT id, lap_monitor_driver_uuid FROM rc_drivers WHERE display_name = 'Brandon'`)
      .get() as { id: string; lap_monitor_driver_uuid: string } | undefined;
    expect(jsonBrandon).toBeDefined();
    expect(jsonBrandon!.lap_monitor_driver_uuid).toBe('F8CFF97C-71B0-4FDA-B054-E820F4B774EF');

    const txtResult = importLapMonitorTxt(db, loadTxtFixture(), trackId, uploader);
    expect(txtResult.status).toBe('ok');
    if (txtResult.status !== 'ok') return;

    // The TXT side OR-matches Brandon by name and reuses the JSON row.
    // Sean is created fresh.
    const brandons = db
      .prepare(`SELECT id, lap_monitor_driver_uuid FROM rc_drivers WHERE display_name = 'Brandon'`)
      .all() as Array<{ id: string; lap_monitor_driver_uuid: string }>;
    expect(brandons).toHaveLength(1);
    expect(brandons[0]!.lap_monitor_driver_uuid).toBe('F8CFF97C-71B0-4FDA-B054-E820F4B774EF');
    expect(brandons[0]!.id).toBe(jsonBrandon!.id);

    const seans = db
      .prepare(`SELECT lap_monitor_driver_uuid FROM rc_drivers WHERE display_name = 'Sean'`)
      .all() as Array<{ lap_monitor_driver_uuid: string }>;
    expect(seans).toHaveLength(1);
    expect(seans[0]!.lap_monitor_driver_uuid).toBe('txt-name:sean');
  });

  it('TXT-then-JSON: TXT creates Brandon; JSON conditional fallback reuses the row', () => {
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);

    const txtResult = importLapMonitorTxt(db, loadTxtFixture(), trackId, uploader);
    expect(txtResult.status).toBe('ok');
    if (txtResult.status !== 'ok') return;

    const txtBrandon = db
      .prepare(`SELECT id, lap_monitor_driver_uuid FROM rc_drivers WHERE display_name = 'Brandon'`)
      .get() as { id: string; lap_monitor_driver_uuid: string };
    expect(txtBrandon.lap_monitor_driver_uuid).toBe('txt-name:brandon');

    const jsonResult = importLapMonitorJson(db, loadJsonFixture(), trackId, uploader);
    expect(jsonResult.status).toBe('ok');

    // The conditional fallback finds the txt-name:brandon row and
    // reuses it. The real UUID is NOT backfilled — known limitation,
    // documented in Hand-offs.
    const brandons = db
      .prepare(`SELECT id, lap_monitor_driver_uuid FROM rc_drivers WHERE display_name = 'Brandon'`)
      .all() as Array<{ id: string; lap_monitor_driver_uuid: string }>;
    expect(brandons).toHaveLength(1);
    expect(brandons[0]!.id).toBe(txtBrandon.id);
    // Per finding #5: the real UUID is NOT written back. The row keeps txt-name:brandon.
    expect(brandons[0]!.lap_monitor_driver_uuid).toBe('txt-name:brandon');
  });

  it('JSON-only stays correct: two distinct drivers with the same first name are NOT merged', () => {
    // Regression guard for the conditional-fallback design choice (Q2).
    // The fallback only fires when the existing row's UUID starts with
    // `txt-name:`. A second JSON driver with a different real UUID must
    // get its own row, even if a first-name collision exists.
    const db = freshDb();
    const uploader = seedUploader(db);
    const trackId = seedTrack(db);

    // First JSON: Brandon with real UUID.
    db.prepare(
      `INSERT INTO rc_drivers(id, lap_monitor_driver_uuid, display_name)
       VALUES (?, ?, ?)`,
    ).run('drv-1', 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', 'Brandon');

    // Second JSON import for a different Brandon with a different UUID.
    // The conditional fallback must NOT match the first Brandon (its
    // UUID doesn't start with `txt-name:`), so a new row is inserted.
    const result = importLapMonitorJson(
      db,
      {
        races: [
          {
            uuid: 'race-uuid-1',
            date: '2026-05-03T09:51:32-07:00',
            kind: 'race',
            drivers: [
              {
                driverUuid: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
                name: 'Brandon',
                transponderId: 1,
                kind: 'driver',
                laps: [
                  { kind: 'initial', duration: 0, endTimestamp: 0, userIndex: 0 },
                  { kind: 'normal', duration: 1500, endTimestamp: 1500, userIndex: 1 },
                ],
              },
            ],
          },
        ],
      },
      trackId,
      uploader,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.summary.driversCreated).toBe(1);
    expect(result.summary.driversReused).toBe(0);

    const brandons = db
      .prepare(`SELECT lap_monitor_driver_uuid FROM rc_drivers WHERE display_name = 'Brandon'`)
      .all() as Array<{ lap_monitor_driver_uuid: string }>;
    expect(brandons).toHaveLength(2);
  });
});
