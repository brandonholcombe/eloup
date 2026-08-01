# M8b — RC truck cup (points series over imported races)

## Author: claude-opus-4.8-m8b-implementer
## Status: Complete

## Outcome (2026-08-01) — SHIPPED, verified live

- Migration 0010 (`rc_cups`/`rc_cup_races`); pure `scoreCup` + `parsePointsScheme`
  (7 unit tests); `lib/db/rc-cup.ts` (4 integration tests); API + UI (Cups section
  on `/racing`, `/racing/cups/[slug]` standings + admin manage).
- Verified live in the local harness with seeded RC data: 2 races → **Willy 18 /
  Sean 16 / Brandon 14** (math correct), medals, add/remove races, scheme editor.
- All 6 reviewer should-fixes folded (scoreCup name, driver_id tiebreak, scheme
  validation, race_kind in picker, split-driver caveat documented, S6 umbrella
  note). Alignment: racing symbol + `docs/racing.md` updated, `align.py lock`
  re-run. vitest 328 → 339.

## Reviewer findings folded (2026-08-01)

Review at `Agents/Review-reports/m8b-rc-cup-review.md` (Reviewer:
`claude-opus-4.8-m8b-reviewer`): **Approve-with-changes** — 0 blocking, 6
should-fix. The load-bearing checks passed: `placement` is dense 1..N for all
race_kinds; penalty/void corrections (`recomputePlacements`) write back INTO
`placement`, so the cup inherits them free; driver identity is stable via
`lap_monitor_driver_uuid`. RC-native call endorsed. Folded:
- **S1:** name collision — the pure scorer is **`scoreCup(rows, scheme)`**; the
  DB fn is `cupStandings(db, cupId)`. Distinct names.
- **S2:** terminal tiebreak is **`driver_id`** (display_name isn't unique):
  points desc → wins desc → best-finish asc → display_name → driver_id.
- **S3:** validate `points_scheme` on write — JSON array of non-negative
  integers, length ≥ 1; reject otherwise.
- **S4:** surface **race_kind** (practice/qualif/race) in the race picker so the
  admin knowingly includes/excludes.
- **S5 (document):** TXT-vs-JSON imports / dual Lap Monitor UUIDs can split one
  human into two `rc_drivers` rows; no merge in v1 — note as a known limitation.
- **S6:** record the RC-native (not `tournaments.format`) deviation in the M8
  umbrella.
- migrate test hardcodes the `[1..9]` version + table lists — must add `0010` +
  `rc_cups`/`rc_cup_races`.

## Parent

Sub-part of `m8-tournament-formats.md`. The user opted to build this now: a
**points-series championship** aggregating the **existing imported RC race
results** — "use the data just like the imported races." Incorporates the M8
umbrella review's 8b corrections (B1/S2/S3).

## Design decisions (grounded in the RC schema)

- **RC-native, NOT a `tournaments`-table tournament.** RC is a separate universe:
  driver-based (`rc_drivers`, `player_id` NULLABLE), display-only, **no ELO**
  (umbrella review B1 — RC never creates `matches` rows). Forcing it into the
  player/ELO `tournaments` table is the mismatch the reviewer flagged. So a cup
  is an RC concept living under `/racing`.
- **Standings key on `driver_id`** (S3 — `rc_drivers.player_id` is nullable;
  keying on player would silently drop unlinked drivers). Display the driver's
  `display_name`; show the linked player when present.
- **Placement source is `rc_race_drivers.placement`** (S2 — 1-based finish per
  race; the same field `standingsForRace()` reads). NOT `rc_drivers`.
- **A cup is an explicit collection of races.** An admin creates a cup and
  assigns imported races to it (they choose which count — so practice/qualifying
  vs race is the admin's call, not an implicit filter). Reuses all existing RC
  import/race data unchanged.
- **Permissions:** reuse `canUploadRaceResults` (the existing RC-admin check) for
  create/manage; standings are anonymous-visible like the rest of racing.

## Data model — migration `0010_rc_cups.sql`

```sql
CREATE TABLE rc_cups (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  points_scheme TEXT NOT NULL,   -- JSON int array; scheme[i] = points for placement i+1, 0 beyond
  created_by    TEXT NOT NULL REFERENCES players(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE rc_cup_races (
  cup_id  TEXT NOT NULL REFERENCES rc_cups(id) ON DELETE CASCADE,
  race_id TEXT NOT NULL REFERENCES rc_races(id) ON DELETE CASCADE,
  PRIMARY KEY (cup_id, race_id)
);
CREATE INDEX idx_rc_cup_races_cup ON rc_cup_races(cup_id);
```

Default `points_scheme` (club-racing style, editable): `[10,8,6,5,4,3,2,1]`
(1st=10 … 8th=1, 0 beyond). No `games` row, no `matches`, no ELO (correct per B1).

## Standings algorithm (pure, unit-tested)

For a cup: gather every `rc_race_drivers` row across the cup's races
(`rc_cup_races` → `rc_race_drivers`), grouped by `driver_id`:
- `points = Σ scheme[placement-1]` (0 when placement > scheme length).
- `races = count`, `wins = count(placement=1)`, `best = min(placement)`.
- Rank by **points desc, then wins desc, then best-finish asc, then name**.
Compute points in JS from the scheme (keep the SQL to the join + raw placements).
Extract the scoring as a pure function `cupStandings(rows, scheme)` so it's
unit-testable without a DB (mirrors the bracket engine's pure-function approach).

## lib + API

- `lib/db/rc-cup.ts`: `createCup`, `listCups`, `getCupBySlug`, `setCupRaces`
  (add/remove), `cupStandings(db, cupId)` (join + pure scorer), `updatePointsScheme`.
- API under `/api/racing/cups`: POST create, and per-cup add/remove races +
  scheme edit — all `canUploadRaceResults`-gated. (Follow the existing racing API
  route patterns.)

## UI (mobile, reuse tokens/primitives)

- **`/racing`**: a "Cups" section listing cups (name + entrant/race counts).
- **`/racing/cups/[slug]`**: standings table (rank/medal, driver, points, W,
  races) — reuse `rankMedal` + `<Card>` + muted-foreground; a list of the cup's
  races (link to each `/racing/[raceId]`); admin controls to add/remove races
  (from the imported race list) + edit the points scheme.
- **Create cup**: admin action on `/racing` (name → create → add races).

## Testing / verification

- Unit: `cupStandings` scoring — points aggregation across races, scheme cutoff
  (placement beyond scheme = 0), tiebreaks (points→wins→best finish), unlinked
  drivers still appear (keyed on driver_id).
- Integration: create cup, assign 2–3 imported races, assert standings order +
  points; add/remove a race changes standings.
- `pnpm lint`/`typecheck`/`build`/`test` green; migrate test +0010 (add
  `rc_cups`/`rc_cup_races` to the table-list + version list).
- Verify via the local seeded harness — BUT the local seed has no RC data; seed a
  couple of RC races (or verify against prod which has real races).
- `docs/racing.md` + racing symbol note the cup; `align.py lock`.

## Non-goals (v1)

Per-race bonus points (fastest lap), drop-scores (best N of M), auto-inclusion by
track/kind (admin assigns races explicitly), driver↔player merge UI. Board-game
round-robin (8a) stays hand-run.

## Review gate

Edits `eloup-web/` (migration + lib + UI) + `symbols/`. Needs an independent
review by a different agent than `## Author:`, referencing `m8b-rc-cup.md`, before
implementation — focus on the standings scoring correctness (driver_id keying,
scheme cutoff, tiebreaks) and that the cup correctly stays ELO-free / RC-native.
