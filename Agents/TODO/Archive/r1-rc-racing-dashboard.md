# R1 — RC racing dashboard (Lap Monitor JSON ingestion)

## Author: claude-opus-4.7-r1-implementer
## Status: Complete

> First milestone outside the multi-game ELO core. Ingests Lap Monitor
> JSON exports and surfaces a per-driver lap chart, leaderboards by
> track configuration, and driver profiles. Race results are
> **display-only** in R1 — no ELO impact. ELO integration is deferred
> to R2 (contract documented at the bottom).
>
> **Author/Reviewer separation note.** Prior implementer agents include
> `claude-opus-4.7-{planner,m2,m3,m4,m5,h1}-implementer`; prior
> reviewers `claude-sonnet-4-6-{m2,m3,m4,m5,h1}-reviewer`. The reviewer
> for this doc must use a `## Reviewer:` field distinct from
> `## Author: claude-opus-4.7-r1-implementer`. Suggested:
> `claude-sonnet-4-6-r1-reviewer`.
>
> The reviewer should land their report at
> `Agents/Review-reports/r1-rc-racing-dashboard-review.md` referencing
> `r1-rc-racing-dashboard.md` in the body. Until then, the review gate
> blocks edits to `eloup-web/`.

---

## Scope

Add a new RC-racing top-level domain to EloUp under `/racing/*`:

- Admin imports a Lap Monitor JSON file (one upload = a batch of races).
- Every race renders a lap-time chart + final standings.
- Per-track leaderboards (best lap, all-time) and per-driver profiles.
- Track configuration is operator-supplied at upload time (the JSON
  does not contain a track field — see §"JSON schema and mapping").
- Driver identity is decoupled from `players` via a stable
  `lap_monitor_driver_uuid`; an admin can later link an `rc_drivers`
  row to a Discord-authenticated `players.id`.

**Out of scope** (R2+):

- ELO integration. Race results don't touch `ratings` or
  `overall_ratings`. R2 will add `rc_ratings` or piggyback on `ratings`
  with a synthetic "game" per track — decision deferred until the data
  model has shaken out.
- Live timing / streaming ingest. R1 is batch upload only.
- Sector-time analytics (the Lap Monitor JSON shipped to us has no
  sector data anyway).
- Side-by-side race comparisons.
- Multi-class racing.
- Predictive lap-time models / fastest theoretical lap.
- Wizard changes. R1 makes zero wizard edits.

---

## Decisions (with rationale)

The R1 prompt flagged five questions. The operator supplied a sample
JSON at `RC/LapMonitor-races.json`; the answers below are derived from
it. Each decision is recorded so the reviewer can push back.

| # | Question | Decision | Why |
|---|---|---|---|
| Q-R1-1 | Sample JSON | **Provided** at `RC/LapMonitor-races.json`; copied to `Agents/fixtures/lap-monitor-sample.json` for test reuse. | The reviewer + the test suite need a stable fixture path that won't drift if the operator reorganizes `RC/`. |
| Q-R1-2 | Driver identity | **(a) — `rc_drivers` keyed on `lap_monitor_driver_uuid`, optional `player_id` link to `players(id)`.** | Lap Monitor exports driver UUIDs (e.g. `F8CFF97C-71B0-4FDA-B054-E820F4B774EF`), not Discord handles. Decoupling lets R1 ship without manual mapping. R2 only credits ELO to drivers with a populated `player_id`. |
| Q-R1-3 | Track configuration | **Operator-specified at upload time** (pivot from the brief's "auto-create from JSON"). The form has a track picker (existing rows) and a "new track" input. Re-uploading the same JSON into a different track is rejected (race UUID is globally unique → idempotency wins). | **The Lap Monitor JSON contains no track / venue field.** Auto-creation is impossible. Specifying at upload is the lowest friction; rename is a future admin tool. |
| Q-R1-4 | Upload mechanism | **(a) + (b)** — File upload form at `/racing/upload` (admin-only, also takes `trackId` or `newTrackName`) AND `POST /api/racing/import` JSON endpoint (same auth check) for scripting. | UI for the operator at parties, API for automation later. Same code path through `importRaceJson`. |
| Q-R1-5 | Charts library | **(c) Pure SVG `<LapChart>`** | The fixture has at most 2 drivers per race with ~10–18 laps each; line counts are trivial. Pure SVG keeps the first-paint JS budget intact (mobile-first constraint caps at ~150KB). No dep, no maintenance tail. Recharts is a fallback if the operator asks for zoom / data-point tooltips later. |

---

## JSON schema and mapping

Lap Monitor's top-level shape (confirmed from
`Agents/fixtures/lap-monitor-sample.json`):

```jsonc
{
  "deviceName": "iPhone",
  "deviceUuid": "91563801-EF0D-4411-B901-CB8259CC1D63",
  "documentType": "com.gyfx.LapMonitor.raceJsonData",
  "version": "1.0.0",
  "races": [
    {
      "uuid": "9B405966-905C-4839-BC02-1A6740BAD92D",  // stable per-race id
      "date": "2026-05-03T09:51:32-07:00",              // ISO-8601 w/ offset
      "duration": 300,                                  // PLANNED seconds
      "extraTime": 40,                                  // seconds
      "minLapTime": 10,                                 // seconds (sanity filter)
      "kind": "qualif" | "practice" | "race",
      "name": "Q12" | "P2" | "final" | "Semi Final",
      "drivers": [
        {
          "driverUuid": "F8CFF97C-71B0-4FDA-B054-E820F4B774EF",
          "transponderId": 80,
          "name": "Brandon",
          "kind": "driver",
          "laps": [
            { "kind": "initial", "duration": 0, "endTimestamp": 0,    "userIndex": 0 },
            { "kind": "normal",  "duration": 2171, "endTimestamp": 2171, "userIndex": 1 },
            { "kind": "ignored", "duration": 1692, "endTimestamp": 15432, "userIndex": -1 },
            ...
          ]
        }
      ]
    }
  ]
}
```

**Key invariants I'll pin in the importer:**

- `races[].duration` is **seconds** (planned race length).
- `laps[].duration` and `laps[].endTimestamp` are **milliseconds**.
- Lap `kind` ∈ `{"initial", "normal", "ignored"}`. Only `normal` counts
  toward placement. **For `initial` laps: `duration` is always 0; the
  `endTimestamp` encodes the start-line crossing offset and is
  non-zero in race-kind laps in the fixture (e.g. `final` Brandon
  initial `endTimestamp: 165`, Willy `endTimestamp: 2`).** Store
  `end_timestamp_ms` as-is — do NOT clamp to 0 for initial laps.
  `ignored` laps exist (false-start / re-cross) but don't count
  toward placement.
- `userIndex` is the 1-based counted-lap number for `normal`, `0` for
  `initial`, `-1` for `ignored`. Cannot be used as a primary key
  (`-1` repeats). The importer stores `lap_number = userIndex`
  verbatim (including 0 and -1); the UI filters by `lap_kind` for
  display rather than re-interpreting `lap_number`.
- `races[].uuid` is the natural idempotency anchor. Same upload twice →
  same race UUIDs → no new rows.
- `drivers[].driverUuid` is the cross-race / cross-upload stable
  identity for a driver.

**Derived fields per `(race, driver)`:**

- `laps_completed` = `count(laps where kind = 'normal')`
- `best_lap_ms`    = `min(laps.duration where kind = 'normal')`
                     (NULL when no normal laps exist)
- `total_time_ms`  = `endTimestamp of the last counted lap` (last
                     `normal` or `ignored`; falls back to 0 if no laps)
- `placement`      = derived per race: order by `(laps_completed DESC,
                     total_time_ms ASC, transponder_id ASC)`. The
                     transponder tiebreak is deterministic.

**Mapping → tables (Phase A schema):**

| JSON path                          | Column                                                 |
|------------------------------------|--------------------------------------------------------|
| `races[i].uuid`                    | `rc_races.lap_monitor_uuid` (UNIQUE — idempotency)     |
| `races[i].date`                    | `rc_races.race_started_at`                             |
| `races[i].kind`                    | `rc_races.race_kind`                                   |
| `races[i].name`                    | `rc_races.race_name`                                   |
| `races[i].duration`                | `rc_races.duration_seconds`                            |
| whole race object                  | `rc_races.source_blob` (TEXT, JSON)                    |
| operator's upload-form choice      | `rc_races.track_id`                                    |
| `auth().user.id`                   | `rc_races.uploaded_by`                                 |
| `races[i].drivers[j].driverUuid`   | `rc_drivers.lap_monitor_driver_uuid` (UNIQUE)          |
| `races[i].drivers[j].name`         | `rc_drivers.display_name` (refreshed on each upload)   |
| `races[i].drivers[j].transponderId`| `rc_race_drivers.transponder_id`                       |
| `races[i].drivers[j].laps[k]`      | one `rc_laps` row per element (including initial+ignored) |
| derived (see above)                | `rc_race_drivers.{placement, laps_completed, best_lap_ms, total_time_ms}` |

---

## Phase A — schema migration `0003_rc_racing.sql`

```sql
-- 0003_rc_racing.sql — RC racing domain (Lap Monitor JSON ingestion).
-- R1 ships display-only race results; ELO integration is R2.

CREATE TABLE rc_tracks (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  layout_notes TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rc_drivers (
  id                       TEXT PRIMARY KEY,
  lap_monitor_driver_uuid  TEXT NOT NULL UNIQUE,
  display_name             TEXT NOT NULL,
  player_id                TEXT REFERENCES players(id),
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rc_races (
  id                TEXT PRIMARY KEY,
  lap_monitor_uuid  TEXT NOT NULL UNIQUE,
  track_id          TEXT NOT NULL REFERENCES rc_tracks(id),
  race_started_at   TEXT NOT NULL,
  race_kind         TEXT NOT NULL CHECK (race_kind IN ('qualif','practice','race')),
  race_name         TEXT,
  duration_seconds  INTEGER,
  source_blob       TEXT NOT NULL,
  uploaded_by       TEXT NOT NULL REFERENCES players(id),
  uploaded_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rc_race_drivers (
  race_id        TEXT NOT NULL REFERENCES rc_races(id) ON DELETE CASCADE,
  driver_id      TEXT NOT NULL REFERENCES rc_drivers(id),
  transponder_id INTEGER NOT NULL,
  placement      INTEGER NOT NULL,
  laps_completed INTEGER NOT NULL,
  best_lap_ms    INTEGER,
  total_time_ms  INTEGER NOT NULL,
  PRIMARY KEY (race_id, driver_id)
);

CREATE TABLE rc_laps (
  race_id          TEXT NOT NULL REFERENCES rc_races(id) ON DELETE CASCADE,
  driver_id        TEXT NOT NULL REFERENCES rc_drivers(id),
  lap_index        INTEGER NOT NULL,
  lap_number       INTEGER,
  lap_time_ms      INTEGER NOT NULL,
  end_timestamp_ms INTEGER NOT NULL,
  lap_kind         TEXT NOT NULL CHECK (lap_kind IN ('initial','normal','ignored')),
  PRIMARY KEY (race_id, driver_id, lap_index)
);

CREATE INDEX idx_rc_races_track_started   ON rc_races(track_id, race_started_at DESC);
CREATE INDEX idx_rc_race_drivers_driver   ON rc_race_drivers(driver_id);
CREATE INDEX idx_rc_laps_race             ON rc_laps(race_id);
CREATE INDEX idx_rc_laps_driver_best
  ON rc_laps(driver_id, lap_time_ms)
  WHERE lap_kind = 'normal';
```

**Why the schema deviates from the brief:**

- The brief proposed `UNIQUE(track_id, race_started_at)` as the
  idempotency anchor. The JSON gives us `races[i].uuid` directly —
  using it as `lap_monitor_uuid UNIQUE` is stricter and survives
  re-imports into a different track choice (the second attempt
  cleanly returns `duplicate` regardless of track).
- `rc_drivers` adds `lap_monitor_driver_uuid` so re-uploads of the
  same driver under a slightly different display name don't create
  duplicate rows.
- `rc_laps` uses `(race_id, driver_id, lap_index)` rather than
  `lap_number` because `userIndex = -1` repeats for ignored laps.
- Stored `transponder_id` on `rc_race_drivers` (not `rc_drivers`) —
  the same driver UUID can use a different transponder per race.
- Added `race_kind` + `race_name` columns: Lap Monitor distinguishes
  qualif / practice / race and labels them ("Q12", "Semi Final"). The
  UI surfaces both.
- Stored the full per-race JSON in `source_blob` for audit + a future
  R2 rebuild path (recompute placement / ELO if logic changes).
- `idx_rc_laps_driver_best` is a partial index over only `'normal'`
  laps for fast best-lap-per-track leaderboards.

---

## Phase B — importer (`lib/rc/import.ts`)

```ts
export type ImportSummary = {
  totalRaces: number;
  insertedRaces: number;
  duplicateRaces: number;     // race uuids that already existed
  driversCreated: number;
  driversReused: number;
  lapsImported: number;
};

export type ImportResult =
  | { status: 'ok';     summary: ImportSummary; raceIds: string[] }
  | { status: 'invalid'; reason: string };

export function importLapMonitorJson(
  db: Database.Database,
  json: unknown,
  trackId: string,
  uploadedBy: string,
  now: () => string = () => new Date().toISOString(),
): ImportResult;
```

**Behavior:**

- Pure function. No I/O except DB writes; no logging side-effects.
- Whole import wrapped in `db.transaction(...).immediate()`.
- Schema validation via `zod`. **Whole-file-fatal validation policy**:
  the importer parses the entire JSON with one strict schema
  (`z.object({ races: z.array(RaceSchema) })`). If any race in the
  batch fails — missing `kind`, non-numeric `duration`, unknown
  `lap.kind` enum, missing `drivers` array, race with no drivers —
  the whole call returns `{ status: 'invalid', reason }` and NO rows
  are written. Rationale: race-tracking data is structured device
  output, not user input; a malformed race almost always indicates a
  Lap Monitor export bug worth fixing at the source, and partial
  imports would silently fragment a session's standings. The
  `ImportSummary` type intentionally has no `skippedRaces` counter to
  enforce this contract. **Never throws** on bad input.
- For each race:
  1. Skip if `rc_races.lap_monitor_uuid` already exists (count as
     `duplicateRaces`, do not re-insert).
  2. Upsert `rc_drivers` by `lap_monitor_driver_uuid`. Update
     `display_name` to the latest seen value. Track count of
     newly-created vs reused.
  3. Compute per-driver `(laps_completed, best_lap_ms, total_time_ms)`.
  4. Sort drivers by `(laps_completed DESC, total_time_ms ASC,
     transponder_id ASC)` to assign `placement` 1..n.
  5. Insert `rc_races`, `rc_race_drivers`, and all `rc_laps` rows
     (bulk via prepared statements inside the same transaction).
- Idempotency rule: re-uploading the same JSON returns `status: 'ok'`
  with `insertedRaces: 0` and `duplicateRaces: <count>`. No mutation
  on duplicates.

---

## Phase C — UI

All routes live under `/racing/*`. All are **anonymous-viewable**
(consistent with `/leaderboards` per Q-APP-4). Only `/racing/upload`
and the `POST /api/racing/import` endpoint require `global_admin`.

| Route                              | Purpose |
|------------------------------------|---------|
| `/racing`                          | Race index (reverse-chrono). Track filter chips at the top. Each row: date · track · race kind+name · driver count · winner. |
| `/racing/[raceId]`                 | Race detail. Header: date, track, race name, driver count. `<LapChart>` (one line per driver). Standings table: placement, driver, laps, best lap, total time. Per-driver lap-by-lap collapse below. |
| `/racing/upload`                   | Admin-only. File-or-paste JSON input + track picker (existing tracks dropdown OR "new track" name field). POSTs to `/api/racing/import`. Displays `ImportSummary` after submit. |
| `/racing/tracks/[slug]`            | All-time best-lap leaderboard for one track. Shows driver, lap time, race it came from (linked). |
| `/racing/drivers/[driverId]`       | Driver profile. Recent races (with placement) + per-track best laps. Shows the linked Discord player handle if `player_id` is set. |

`<LapChart>` (pure SVG):

- One polyline per driver, distinct color via `hash(driver_id) → HSL`.
- X axis = lap number (1..N), Y axis = lap time in seconds (formatted
  `mm:ss.mmm` for tick labels and tooltips).
- Outliers (e.g. the 11s lap visible in the fixture) clip to the
  **95th percentile** of Y by default with a "show outliers" toggle.
  95th is chosen because the `final` race fixture has Brandon's lap
  11 at 11,374ms vs a median ~1,900ms; a 90th-percentile clip would
  cut multiple legitimate slow-but-real laps in a race with frequent
  incidents. The chosen threshold is pinned by a chart-unit test;
  the table below still shows raw values.
- 414px-wide mobile target. Touch-tap on a line/dot reveals the
  driver name + lap time via a focusable `<title>` element
  (works without hover).
- Legend = horizontally-scrollable chip strip above the chart;
  paginates implicitly via overflow scroll for >6 drivers.

`<TrackFilter>`:

- Chip-style toggle row. "All" + one chip per distinct
  `rc_tracks.slug`. Selecting a chip updates the URL
  (`/racing?track=outdoor-long`) so it's shareable.

---

## Phase D — permissions

Extend `lib/permissions.ts`:

```ts
export function canUploadRaceResults(s: SessionPlayer | null): boolean {
  return s?.role === 'global_admin';
}
```

Matches the shape of `canCreateGame`. The `/api/racing/import` route
returns 401 if `session?.user` is missing, 403 if
`canUploadRaceResults` is false. Anonymous viewers can read all
`/racing/*` pages.

`adminNavLinks` gains:

```ts
[{ href: '/games', label: 'Games' }, { href: '/racing/upload', label: 'Upload Race' }]
```

---

## Phase E — nav

Add a "Racing" slot to `BottomNav` for everyone. Final order:

```
Boards · Racing · Matches · Cups · Me
```

Rationale: Racing is a read-heavy browse surface like Boards, so they
sit together. The 5-item layout fits within the existing `max-w-md`
container at 414px (≈ 83px per slot, > 44px tap target). When signed
out the SignIn button replaces a slot rather than appending a 6th —
already the case in `BottomNav.tsx`.

---

## Phase F — chart polish

Already in §Phase C, but separated for review clarity:

- Deterministic per-driver color from `hash(driver_id)` → HSL hue.
- Touch-friendly: `<polyline>` markers use `<title>` for tap-reveal;
  no hover-only affordances.
- Y-axis ticks formatted `mm:ss.mmm` (helper in `lib/rc/format.ts`).
- Outlier clipping (95th percentile by default — see Phase C
  rationale).
- Legend overflow-scrolls when >6 drivers — the fixture maxes out at
  2 today, but the schema permits any count.

---

## Phase G — symbol + docs

Add a top-level `racing` symbol to `symbols/manifest.json`:

```json
"racing": {
  "description": "RC-car racing dashboard backed by Lap Monitor JSON exports. Display-only in R1: per-driver lap chart, per-track best-lap leaderboards, driver profiles. ELO integration is deferred to R2.",
  "docs": ["docs/racing.md"],
  "properties": {
    "source": "lap_monitor",
    "ingest_mode": "batch_upload",
    "track_model": "operator_specified_at_upload",
    "driver_identity_model": "separate_with_optional_player_link",
    "chart_strategy": "svg_inline",
    "elo_integrated": false,
    "upload_role": "global_admin",
    "anonymous_view": true
  },
  "interlocks": {}
}
```

Write `docs/racing.md` covering:

- Stack picks + rationale (mirror existing docs/*.md tone).
- The Lap Monitor JSON contract (a copy of §"JSON schema and mapping").
- Route table.
- Permission model (admin-only writes, anonymous reads).
- Hand-off to R2.

Run `python3 scripts/align.py lock` after the symbol edit. Commit
`manifest.json` + `manifest.lock` + `docs/racing.md` together (commit 4).

---

## Files I'll change

Under `eloup-web/`:

- `lib/db/migrations/0003_rc_racing.sql` — new
- `lib/db/rc.ts` — new: typed query helpers (`listRaces`, `getRace`,
  `listTracks`, `getTrackBySlug`, `listDrivers`, `getDriver`,
  `bestLapsForTrack`, `recentRacesForDriver`, `lapsForRace`)
- `lib/rc/import.ts` — new: `importLapMonitorJson`
- `lib/rc/format.ts` — new: `formatLapMs(n)` → `mm:ss.mmm`
- `lib/rc/colors.ts` — new: `driverColor(id)` → HSL string
- `lib/permissions.ts` — extend with `canUploadRaceResults` and
  `adminNavLinks` entry
- `app/api/racing/import/route.ts` — new
- `app/racing/page.tsx` — new
- `app/racing/[raceId]/page.tsx` — new
- `app/racing/upload/page.tsx` — new (admin-only)
- `app/racing/tracks/[slug]/page.tsx` — new
- `app/racing/drivers/[driverId]/page.tsx` — new
- `components/LapChart.tsx` — new (pure SVG, no client deps)
- `components/TrackFilter.tsx` — new
- `components/RcUploadForm.tsx` — new (client; talks to import route)
- `components/BottomNav.tsx` — add Racing slot **and extend the
  `href` union type to include `'/racing'`** (the existing
  `ITEMS` declaration types `href` as a literal union; adding a slot
  without widening the union breaks `pnpm typecheck`).
- `tests/integration/rc-import.test.ts` — new
- `tests/integration/rc-queries.test.ts` — new
- `tests/unit/rc-permissions.test.ts` — new
- `tests/unit/rc-format.test.ts` — new

Outside `eloup-web/`:

- `Agents/fixtures/lap-monitor-sample.json` — new (already copied)
- `symbols/manifest.json` — add `racing` symbol
- `symbols/manifest.lock` — regenerated by `align.py lock`
- `docs/racing.md` — new

---

## Six must-work flows

1. **Admin upload (UI).** Signed-in `global_admin` visits
   `/racing/upload`, picks a track from the dropdown OR types a new
   track name, pastes/uploads the fixture JSON, submits. Server
   auto-creates the track row (if "new"), runs `importLapMonitorJson`,
   redirects to `/racing` showing the new races at the top.
2. **Anonymous browse.** A signed-out visitor opens `/racing` and sees
   the reverse-chronological race list (track, kind+name, driver
   count, winner). No sign-in prompt.
3. **Race detail.** Any visitor opens `/racing/<raceId>` and sees:
   header (date, track, race name), `<LapChart>` (one line per
   driver, deterministic colors, mm:ss.mmm Y-axis), and the final
   standings table. Each driver row is collapsible to show their
   lap-by-lap breakdown (including ignored laps marked as such).
4. **Track filter.** Any visitor clicks a chip in `<TrackFilter>` on
   `/racing`. URL updates to `?track=<slug>`; list filters; chip
   toggles to "active" style. "All" chip clears.
5. **Driver profile.** Any visitor opens `/racing/drivers/<id>`. Sees
   the driver's recent races (with placement), per-track best laps,
   and (if `player_id` is set) the linked Discord display name + a
   link to that player's `/profile`.
6. **Track leaderboard.** Any visitor opens `/racing/tracks/<slug>`.
   Sees all-time best laps for that track, ranked, with the source
   race linked. **Idempotency check (admin-only path):** re-uploading
   the same JSON to the same track returns the import summary with
   `insertedRaces: 0`, `duplicateRaces: <count>`. No new rows.

---

## Test plan

Vitest (per the M4/M5 pattern: ephemeral SQLite per test file, no
mocks):

- `tests/integration/rc-import.test.ts`
  - Happy path against `Agents/fixtures/lap-monitor-sample.json`:
    correct row counts in `rc_races`, `rc_drivers`, `rc_race_drivers`,
    `rc_laps`.
  - Placement derivation: for a fixture race, assert the winner has
    the most `normal` laps and lowest total time.
  - `best_lap_ms` matches `min(laps.duration where kind=normal)` from
    the fixture.
  - Idempotency: second import returns
    `insertedRaces: 0, duplicateRaces: 15`.
  - Re-import with a different driver `display_name` updates the
    existing `rc_drivers` row rather than creating a duplicate.
  - Re-import to a *different* track is still a duplicate (race UUID
    is globally unique).
- `tests/integration/rc-queries.test.ts`
  - `listRaces` returns reverse-chrono order.
  - `listRaces({ trackId })` filters correctly.
  - `bestLapsForTrack` ranks ascending by `lap_time_ms`, joins driver
    display name.
- `tests/unit/rc-permissions.test.ts`
  - `canUploadRaceResults(null)` → false
  - `canUploadRaceResults({role: 'user'})` → false
  - `canUploadRaceResults({role: 'tournament_admin'})` → false
  - `canUploadRaceResults({role: 'global_admin'})` → true
- `tests/unit/rc-format.test.ts`
  - `formatLapMs(2171)` → `"00:02.171"`
  - `formatLapMs(0)` / large values / negative guards
- **Malformed input** (whole-file-fatal policy — see Phase B):
  - Missing `races` key → `{ status: 'invalid', reason: ... }`, no
    DB writes.
  - Race with no drivers → `{ status: 'invalid', ... }`.
  - **One bad race in a 15-race batch** (e.g. `kind: 'unknown'`) →
    `{ status: 'invalid' }`; assert ZERO rows landed across all
    `rc_*` tables.
  - Garbage non-JSON via the API route → 400.
- **Chart unit test** (`tests/unit/lap-chart-clip.test.ts`): pin the
  95th-percentile outlier clip — feed a 20-point series with one
  10× outlier and assert the chart's effective max-Y equals the
  95th-percentile sample, not the raw max.
- Optional Playwright `e2e/racing-golden-path.spec.ts` (deferred if
  time-boxed): admin uploads fixture → anon visitor sees race detail
  page render correctly (chart present, table populated).

No database mocks. Each integration test file calls
`mkdtempSync(...)`/`applyMigrations(...)` per the existing pattern in
`tests/integration/admin-force-confirm.test.ts`.

---

## Quality bar (same as M4 + M5 + H1)

- No comments unless WHY is non-obvious.
- No DB mocks. Ephemeral SQLite per integration test file.
- TypeScript strict; no `any` without a `// reason:` line.
- ESLint + Prettier clean.
- Mobile-first: `<LapChart>` MUST be readable on a 414px-wide screen;
  tap targets ≥ 44×44.
- Lighthouse mobile budget intact — no heavy charting lib.
- Pure-SVG chart implementation reviewed for accessibility (axis
  labels, role="img", `<title>` per polyline, focusable legend).

---

## Verification

1. `python3 scripts/align.py check` exits 0.
2. `cd wizard && python3 -m pytest -q` — wizard tests still pass
   (R1 makes zero wizard edits).
3. `cd eloup-web && pnpm test && pnpm lint && pnpm typecheck && pnpm build` — clean.
4. `docker build` on `eloup-web` succeeds.
5. Local smoke (inside a container with the standard env vars):
   - Upload `Agents/fixtures/lap-monitor-sample.json` via `/racing/upload`
     against a fresh track ("Outdoor Long"). Confirm:
     - 15 races appear on `/racing` (the fixture has 15).
     - `/racing/<id>` renders the chart + standings for the "final" race.
     - Re-uploading the same JSON returns `insertedRaces: 0`.
     - `/racing/tracks/outdoor-long` ranks Brandon and Willy by best
       lap (smallest `lap_time_ms` first).
     - `/racing/drivers/<id>` shows the driver's recent races.
6. Live verification on `tow-c1` (operator-driven, after the
   wizard re-runs):
   - Re-run the wizard exactly as for prior commits (H1 / InfoTip
     deploys).
   - Upload a real Lap Monitor JSON via the production `/racing/upload`.
   - Open `https://eloup.kodloki.io/racing/<id>` on a phone; confirm
     the chart is legible and the table is touch-friendly.
   - Confirm `rc_*` row counts post-deploy match pre-deploy (no data
     loss across the migration).

---

## Commit shape (mirrors M2–M5 + H1)

1. `docs: R1 — RC racing dashboard task doc` — this file +
   `Agents/fixtures/lap-monitor-sample.json` only.
2. `docs: R1 — reviewer report` — landed by a different agent in
   `Agents/Review-reports/`.
3. `feat: eloup-web — RC racing schema + importer + permissions` —
   migration `0003`, `lib/db/rc.ts`, `lib/rc/{import,format,colors}.ts`,
   `lib/permissions.ts` extension, `/api/racing/import` route, all
   tests. No UI beyond the API.
4. `feat: eloup-web — RC racing dashboard UI + nav + symbol` — pages
   under `/racing/*`, `LapChart.tsx`, `TrackFilter.tsx`,
   `RcUploadForm.tsx`, `BottomNav` update, `adminNavLinks` update,
   `docs/racing.md`, `symbols/manifest.json` racing symbol +
   regenerated `symbols/manifest.lock`.

Each commit ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Hand-off to R2 (ELO integration)

`rc_races` and `rc_race_drivers` carry everything R2 needs to compute
per-driver rating updates: `placement`, `laps_completed`,
`best_lap_ms`, `total_time_ms`, `race_started_at`, `track_id`,
`race_kind`. `rc_races.source_blob` retains the raw JSON for
recompute.

**R2 decision matrix (deferred):**

- (a) Separate `rc_ratings(player_id, track_id, current_rating, ...)`
  — one ELO pool per track. Most accurate, but fragments ratings
  across tracks.
- (b) Single RC-overall pool keyed on `player_id` — easier
  leaderboard, less track-aware skill modeling.
- (c) Synthetic `games` rows per track configuration; reuse M4's
  `applyEloUpdate` unchanged with a `matches` row per race that has
  the same participant set. Cleanest reuse, but co-mingles RC with
  the casual-party leaderboards.

The `rc_drivers.player_id` linkage is the bridge to the existing
ELO system: in R2, only drivers with a populated `player_id` show up
in the overall leaderboards. Drivers without a Discord link have
RC-local ratings only (R2 will need to decide how to surface them).

When R2 starts, the implementer should pick (a)/(b)/(c) based on
whether RC racing should be a peer of the casual-party games (→ c) or
a separate competitive ladder (→ a/b).

**Buried fields R2 may want to surface.** `minLapTime` (and
`extraTime`) live inside `rc_races.source_blob` rather than as
typed columns. If R2 ever recomputes placements from `source_blob`
in SQL, it must re-apply the same `minLapTime` threshold to produce
identical results. Easiest path: add an `0004_rc_recompute.sql`
migration that extracts `min_lap_time_ms` to a typed column on
`rc_races` before R2 starts touching the recompute logic.

---

## Resolved review notes (2026-05-17)

The independent review at
`Agents/Review-reports/r1-rc-racing-dashboard-review.md` returned
**SHIP WITH FIXES** with 2 [MAJOR] + 3 [MINOR] + 3 [NIT] findings.
Sections above have been amended where the review changed the plan;
this section records what changed and why.

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | MAJOR | Outlier clip self-contradicts (90th in Phase C, 95th in Phase F). | Picked **95th percentile**, updated Phase C, added rationale, added pinning test `tests/unit/lap-chart-clip.test.ts`. |
| 2 | MAJOR | Zod validation granularity unspecified — one bad race in a 15-race file? | Declared **whole-file-fatal** policy in Phase B (rationale: structured device output, partial imports fragment standings). Added a malformed-input test that asserts ZERO rows on one bad race in a 15-race batch. |
| 3 | MINOR | "initial is always 0ms" is imprecise — `endTimestamp` is non-zero. | Refined the invariant: `duration` is always 0; `endTimestamp` is the start-line crossing offset and must be stored as-is. |
| 4 | MINOR | `BottomNav.tsx` `href` union not called out. | Files-I'll-change bullet now requires extending the union. |
| 5 | MINOR | Nullable `transponder_id` makes the tiebreak silently unfair. | Made `transponder_id NOT NULL` on `rc_race_drivers`; the fixture always provides it and the importer's zod schema requires it too. |
| 6 | NIT   | `lap_number` mapping to `userIndex` unclear. | Pinned in §"JSON schema and mapping": "store `lap_number = userIndex` verbatim". |
| 7 | NIT   | `minLapTime` buried in `source_blob`. | Added a "Buried fields R2 may want to surface" note in the R2 hand-off section. |
| 8 | NIT   | `racing` symbol has empty `interlocks`. | Left as-is for consistency with the existing `tournaments` and `betting` symbols, both of which also use `{}`. Will revisit project-wide if `align.py` grows machine-checked role interlocks.
