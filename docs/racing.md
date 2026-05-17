# RC racing dashboard

EloUp's RC-racing domain ingests Lap Monitor JSON exports and surfaces
per-driver lap charts, per-track leaderboards, and driver profiles.
R1 is display-only — race results do not affect any ELO rating. ELO
integration is planned as a follow-up (R2) once the data model has
shaken out in production.

## Stack picks

| Pick | Rationale |
|---|---|
| **better-sqlite3 direct** + versioned `.sql` migrations | Matches the M4 baseline; the new `rc_*` tables land in `0003_rc_racing.sql` alongside the existing schema. No ORM. |
| **`zod`** for JSON parsing | The Lap Monitor JSON shape is well-defined but device-emitted; `zod` gives whole-file-fatal validation with structured errors and no exception leaks. |
| **Pure SVG `<LapChart>`** | At most a handful of drivers and ~50 laps per race; pure SVG keeps the mobile-first JS budget intact (no charting library required). Outlier clipping at the 95th percentile is pinned by `tests/unit/lap-chart-clip.test.ts`. |
| **Anonymous-viewable routes** | Per `Q-APP-4` (leaderboards are public). Only `/racing/upload` and `POST /api/racing/import` require `global_admin`. |
| **Operator-specified track at upload** | The Lap Monitor JSON has no track / venue field, so the operator picks (or creates) a track at upload time. Auto-creation on first appearance was the original brief default but is impossible given the actual JSON shape. |

## The Lap Monitor JSON contract

The fixture at `Agents/fixtures/lap-monitor-sample.json` is the
canonical reference. Confirmed invariants:

- **Top-level**: `{ deviceName, deviceUuid, documentType, version, races: [...] }`.
- **Per race**: `{ uuid, date, duration (seconds), extraTime, minLapTime, kind, name, drivers: [...] }`.
  - `kind ∈ {"qualif", "practice", "race"}`.
  - `name` is the heat label ("Q12", "P2", "final", "Semi Final").
  - `uuid` is the global idempotency anchor — `rc_races.lap_monitor_uuid UNIQUE` rejects duplicate uploads even into a different track.
- **Per driver**: `{ driverUuid, name, transponderId, kind: "driver", laps: [...] }`.
  - `driverUuid` is the cross-race / cross-upload stable identity. Stored on `rc_drivers.lap_monitor_driver_uuid UNIQUE`.
- **Per lap**: `{ kind, duration (ms), endTimestamp (ms), userIndex }`.
  - `kind ∈ {"initial", "normal", "ignored"}`. Only `normal` counts toward placement.
  - `initial` laps have `duration: 0`; their `endTimestamp` is the start-line crossing offset and is non-zero in race-kind laps (e.g. the `final` race: Brandon initial `endTimestamp: 165`, Willy `endTimestamp: 2`). Stored as-is.
  - `userIndex` is the 1-based counted-lap number for `normal`, `0` for `initial`, `-1` for `ignored`. Repeats for ignored laps and cannot be a primary key — `rc_laps` keys on array-position `lap_index` instead and stores `lap_number = userIndex` verbatim.

### Derived per-`(race, driver)` columns

| Column | Formula |
|---|---|
| `laps_completed` | `count(laps where kind = 'normal')` |
| `best_lap_ms`    | `min(laps.duration where kind = 'normal')` (NULL when no normal laps) |
| `total_time_ms`  | `endTimestamp` of the last `normal`-or-`ignored` lap (0 if no laps) |
| `placement`      | sort by `(laps_completed DESC, total_time_ms ASC, transponder_id ASC)` |

### Validation policy

**Whole-file-fatal**: a single malformed race (missing `kind`,
non-numeric `duration`, unknown `lap.kind`, no drivers) makes the
entire `importLapMonitorJson` call return
`{ status: 'invalid', reason }` with no DB writes. Rationale: race
data is structured device output, not user input; partial imports
would silently fragment a session's standings.

## Route table

| Route | Auth | Purpose |
|---|---|---|
| `/racing` | anon | Race index (reverse-chrono). `?track=<slug>` filters via `<TrackFilter>`. |
| `/racing/[raceId]` | anon | Race detail: header · `<LapChart>` · final standings · per-driver lap-by-lap. |
| `/racing/tracks/[slug]` | anon | All-time best-lap leaderboard for one track. |
| `/racing/drivers/[driverId]` | anon | Driver profile: best lap per track + recent races. Shows linked Discord handle if `rc_drivers.player_id` is set. |
| `/racing/upload` | `global_admin` | Upload form: paste/upload JSON + pick or create a track. |
| `POST /api/racing/import` | `global_admin` | Body: `{ trackId? \| newTrackName?, json }`. Returns `{ status: 'ok', summary, raceIds }` or `{ status: 'invalid', reason }`. |

## Permission model

`canUploadRaceResults(session)` mirrors `canCreateGame`:
`session?.role === 'global_admin'`. Both the page (`/racing/upload`)
and the API route (`POST /api/racing/import`) enforce it: anonymous
visitors get 401, authenticated non-admins get 403. Everything else
under `/racing/*` is fully public.

## Files

- `lib/db/migrations/0003_rc_racing.sql` — schema
- `lib/db/rc.ts` — typed query helpers
- `lib/rc/import.ts` — `importLapMonitorJson`
- `lib/rc/format.ts` — `formatLapMs`
- `lib/rc/colors.ts` — `driverColor`
- `app/racing/**` — pages
- `app/api/racing/import/route.ts` — API endpoint
- `components/LapChart.tsx`, `TrackFilter.tsx`, `RcUploadForm.tsx` — UI

## Hand-off to R2 (ELO integration)

`rc_races` and `rc_race_drivers` carry everything R2 needs to compute
per-driver rating updates: `placement`, `laps_completed`,
`best_lap_ms`, `total_time_ms`, `race_started_at`, `track_id`,
`race_kind`. `rc_races.source_blob` retains the raw per-race JSON so
R2 can recompute placements with new logic.

R2 decision matrix (deferred):

- **(a)** Separate `rc_ratings(player_id, track_id, ...)` — one ELO
  pool per track configuration. Most accurate, fragments ratings.
- **(b)** Single RC-overall pool keyed on `player_id` — easier
  leaderboard, less track-aware skill modeling.
- **(c)** Synthetic `games` rows per track configuration with
  matching `matches` rows; reuse M4's `applyEloUpdate` unchanged.
  Cleanest reuse, but co-mingles RC with the casual-party leaderboards.

`rc_drivers.player_id` is the bridge to the existing ELO system —
only drivers with a populated `player_id` participate in the overall
leaderboards. Drivers without a Discord link have RC-local ratings only.

**Buried fields R2 may want to surface.** `minLapTime` and `extraTime`
live inside `source_blob` rather than as typed columns. If R2
recomputes placement from `source_blob` in SQL, it needs to re-apply
the same `minLapTime` threshold to produce identical results. An
`0004_rc_recompute.sql` migration that extracts
`min_lap_time_ms` to `rc_races` is the natural prep step.
