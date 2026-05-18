# H6 — Race-kind-aware ranking + void-laps admin action

## Author: claude-opus-4.7-h6-implementer
## Status: In Progress

## Reviewer findings folded (2026-05-17)

Reviewer `claude-sonnet-4-6-h6-reviewer` returned APPROVE-WITH-CHANGES
(3 MAJOR, 4 MINOR, 1 NIT). The 3 MAJOR fixes baked into the plan
before implementation begins:

1. **`standingsForRace` must SELECT `voided_laps_count`** — Phase D
   scope is extended to include the SELECT-clause addition (not just
   the `RcStandingRow` type). Without this, the PATCH response's
   `voided_laps_count` field is silently `undefined`.

2. **Migration 0007 zero-normal-lap fix** — the `ranked_laps` CTE's
   INNER JOIN to `rc_laps` silently drops drivers with only
   `initial`/`ignored` laps. Phase G restructured to LEFT JOIN /
   GROUP BY over `rc_race_drivers`, so zero-normal-lap drivers appear
   in the result with `n_laps = 0` and sink to the bottom via the
   existing `CASE WHEN n_laps >= 3 THEN 0 ELSE 1 END` clause.

3. **Phase H "Top-3 avg" column computation path** — the page server
   component (`app/racing/[raceId]/page.tsx`) reads `lapsForRace`,
   groups normal laps by driver, applies `rankingLapTimes(asc, voided)`
   per driver, then averages the first 3. Per-driver
   `rankingTop3AvgMs: number | null` map is passed into the standings
   table render (display `—` when `< 3` ranking laps).

Locked positions on the 6 clarifying questions (CQ1–CQ6) match the
defaults in the plan. Folded specifics:

- CQ2: zod PATCH body uses `.strict()` on each branch — sending both
  `penalty_ms` and `voided_laps_count` returns 400.
- CQ5: `computeDriverStats` stays void-blind; rankings top-3 avg is
  computed in the page server component.

Other folded MINOR fixes:

- `RaceAdminPanel.activePenalties` is race-kind-aware: counts
  `voidedLapsCount > 0` for qualif/practice, `penaltyMs > 0` for race.
  Badge copy reads "voids" or "penalties" accordingly.
- `recomputePlacements` accepts a pre-prepared `lapsStmt` as a param
  to match the established pattern.
- `PlacementInput.voidedLapsCount` is removed (the field is the
  caller's responsibility before constructing `PlacementInput`; the
  sort consumes only `rankingLapsAscMs`).

> **Author/Reviewer separation note.** Prior implementers are
> `claude-opus-4.7-{planner,m2,m3,m4,m5,h1,r1,h2,h3,h4,h5}-implementer`;
> prior reviewers are
> `claude-sonnet-4-6-{m2,m3,m4,m5,h1,r1,h2,h3,h4,h5}-reviewer` (plus
> the early `claude-sonnet-4-6-reviewer`). The reviewer for this doc
> must use a `## Reviewer:` field distinct from `## Author:
> claude-opus-4.7-h6-implementer`. Suggested:
> `claude-sonnet-4-6-h6-reviewer`.
>
> The reviewer should land their report at
> `Agents/Review-reports/h6-race-kind-ranking-review.md` referencing
> `h6-race-kind-ranking.md` in the body. Until then, the review gate
> blocks edits to `eloup-web/`.

---

## Why this task exists

R1 shipped the importer with one placement-ordering function:
`comparePlacement(a, b)` in `lib/rc/import.ts:279` — `laps DESC,
total_time_ms ASC, transponder ASC`. H2 added `penalty_ms` to the
tiebreak (adjusted total). H3 added TXT import. H4 added hard
delete. H5 added desktop/QoL.

Every one of those changes kept the same single sort order across
all three race kinds (`race`, `practice`, `qualif`). That is wrong
for two of them:

1. **Practice and qualifying are top-3-avg surfaces, not race-time
   surfaces.** In an RC club's qualifying session, the operator
   doesn't care about laps-completed or cumulative time — they care
   about each driver's three fastest laps averaged together. The
   `computeDriverStats` helper already computes `top3AvgMs` correctly
   for the stats grid (`lib/rc/stats.ts:71`); the standings table on
   the same race-detail page shows a *different* ranking derived from
   laps + total time. The two orderings disagree, which the operator
   noticed at last weekend's club night.

2. **The operator has no penalty mechanism that makes sense for
   qualif/practice.** H2's `penalty_ms` adds time to a total — but
   qualif/practice ranking doesn't use total time, so penalty_ms has
   no effect on placement there. The right penalty mechanism for a
   jump-start in qualifying is "void this driver's fastest lap" —
   the offender drops one slot in the top-3-avg picking, hurting
   their average. The current schema has no way to express that.

H6 fixes both: race kinds get separate placement orderings, and
qualif/practice gets a per-driver "void N laps" admin action that
skips the N fastest normal laps from the top-3-avg computation.

---

## Operator decisions (locked in — do not relitigate)

| # | Question | Decision |
|---|---|---|
| Q-H6-1 | Race-kind ranking shape | `race` → laps DESC, `(total_time_ms + penalty_ms)` ASC, transponder ASC (UNCHANGED). `practice` / `qualif` → top-3-avg of normal laps ASC. |
| Q-H6-2 | Qualif/practice tiebreaks (≥3 normal laps) | top-3-avg ASC, best-lap ASC, laps_completed DESC, transponder ASC. |
| Q-H6-3 | Qualif/practice fallback for `<3` normal laps | Driver sinks to the bottom. Among <3-lap drivers: best-lap ASC (null = last), transponder ASC. |
| Q-H6-4 | Penalty semantics in qualif/practice | NEW per-driver column `voided_laps_count`. When > 0, the top-3-avg computation skips the N fastest normal laps. `penalty_ms` is preserved (admin can still set it for record-keeping) but does NOT affect qualif/practice ranking. |
| Q-H6-5 | Admin UI per race kind | `race` shows the existing penalty (seconds). `qualif` / `practice` shows "Void N laps" (integer stepper). Both rows can be present simultaneously in the DB — only the relevant one affects ranking. |
| Q-H6-6 | Backfill | One-time data-fixup migration recomputes placement for ALL existing `practice` + `qualif` rows. `race` rows are untouched. |
| Q-H6-7 | `computeDriverStats` behavior | Continues to show RAW top-3-avg (no voids applied). Voids only affect the standings table's placement + the qualif-ranking-specific top-3-avg display. Stats stay true to the data. |
| Q-H6-8 | Void cap | `0 ≤ voided_laps_count ≤ 10`. API enforces upper bound; DB CHECK enforces non-negativity. |
| Q-H6-9 | API shape | Existing PATCH at `/api/racing/races/[raceId]/drivers/[driverId]` accepts EITHER `{ penalty_ms }` OR `{ voided_laps_count }` (zod discriminated by which key is present). Same 401/403/404. Response: `{ status, placement_before, placement_after, penalty_ms, voided_laps_count }`. |
| Q-H6-10 | Migration count | `0006_rc_voided_laps.sql` (schema) + `0007_recompute_qualif_placement.sql` (data backfill). |
| Q-H6-11 | Permission helper | Reuse `canEditRace` (`global_admin` only). |
| Q-H6-12 | Wizard changes? | None. |
| Q-H6-13 | Symbol changes? | None. The `racing` symbol describes the domain at a coarse grain (display-only, anonymous-readable, admin-uploaded). Race-kind ranking is below that grain. |

---

## Files I'll change

Under `eloup-web/`:

| File | Status | Change |
|---|---|---|
| `lib/db/migrations/0006_rc_voided_laps.sql` | new | `ALTER TABLE rc_race_drivers ADD COLUMN voided_laps_count INTEGER NOT NULL DEFAULT 0 CHECK (voided_laps_count >= 0)`. Idempotent via `schema_migrations`. |
| `lib/db/migrations/0007_recompute_qualif_placement.sql` | new | One-time data fixup: recompute `placement` for `rc_race_drivers` rows whose race is `practice` or `qualif`. Uses CTEs + window functions; see Phase G below. |
| `lib/rc/placement.ts` | new | Shared `comparePlacement(a, b, raceKind)` + `rankingLapTimes(normalLapTimesAscMs, voidedLapsCount)` helpers. Exported types: `RaceKind`, `PlacementInput`. |
| `lib/rc/import.ts` | edit | Replace the local `comparePlacement` with the shared helper. Build `PlacementInput` from per-driver computed standings (already have `lapsCompleted`, `bestLapMs`, `totalTimeMs`; add `rankingLapsAscMs` computed from `normal` laps; `voidedLapsCount` is 0 on fresh import; `penaltyMs` is 0). Pass `race.kind` into the sort. |
| `lib/rc/import-txt.ts` | edit | Same shape — drop local `comparePlacement`, use shared helper with `parsed.raceKind`. |
| `lib/db/rc.ts` | edit | (1) Add `voided_laps_count: number` to `RcStandingRow`; SELECT and surface it. (2) Replace `setDriverPenalty`'s in-tx SQL recompute with a JS sort using the shared helper (fetches per-driver normal lap times). (3) Add `setVoidedLapsCount(db, raceId, driverId, count): { status: 'ok' \| 'no_row' \| 'invalid' }`. Validates non-negative integer; UPDATE the column; recompute placements in the same tx via the shared helper. Reuses the same placement-recompute primitive as `setDriverPenalty`. |
| `app/api/racing/races/[raceId]/drivers/[driverId]/route.ts` | edit | Extend the PATCH handler to accept EITHER `{ penalty_ms: number }` OR `{ voided_laps_count: number }` (zod discriminated). Cap `voided_laps_count <= 10`. Response: `{ status, placement_before, placement_after, penalty_ms, voided_laps_count }`. |
| `components/RaceAdminPanel.tsx` | edit | New `raceKind` prop. Penalty input renders ONLY when `raceKind === 'race'`. Void-laps stepper (integer 0..10) renders when `raceKind === 'practice' \|\| raceKind === 'qualif'`. Each row independent — Save button fires the relevant PATCH branch. New copy: for qualif/practice with voided_laps_count change → "Position unchanged — ranking uses top-3 avg of remaining laps"; for qualif/practice with penalty_ms change (if shown) → "Penalty applied for record only — qualif ranking uses lap times". |
| `app/racing/[raceId]/page.tsx` | edit | Pass `raceKind` into `RaceAdminPanel`. Pass `voidedLapsCount` per driver. Standings table: when `race.race_kind === 'practice' \|\| === 'qualif'`, show a "Top-3 avg" column derived from the post-void ranking laps (replaces / supplements "Total" — see Phase H detail). |
| `tests/unit/rc-placement.test.ts` (new) | new | `comparePlacement` for both branches with normal cases, ties, <3-lap fallback, voided_laps shifting picked laps. `rankingLapTimes(laps, voided)` happy + edge cases. |
| `tests/unit/rc-admin-edits.test.ts` | edit | Add `setVoidedLapsCount` happy / invalid / no_row / placement-reorders cases. Update existing assertions if any rely on placement ordering of practice/qualif rows. |
| `tests/integration/rc-admin-edits.test.ts` | edit | PATCH with `voided_laps_count` returns `placement_before` / `placement_after`. Both branches respect the auth gates. |
| `tests/integration/rc-import.test.ts` | edit | A qualif race fixture imports with top-3-avg placement. (May add a new small fixture; current fixture only includes a race-kind race — confirm and extend if needed.) |
| `tests/integration/rc-backfill-0007.test.ts` (new) | new | Seed a fixture practice race with known data, run migrations, assert new placement order matches top-3-avg ranking. Migration is idempotent. |
| `tests/unit/migrate.test.ts` | edit | Add 0006 + 0007 idempotency cases. |

Out of `eloup-web/`: no symbol changes (per Q-H6-13), no docs changes,
no wizard changes.

---

## Phase A — Schema migration 0006

```sql
-- 0006_rc_voided_laps.sql — Per-driver count of voided fastest laps.
-- H6: qualif/practice penalty mechanism. When > 0, the top-3-avg
-- computation skips the N fastest normal laps for ranking only.
-- Stats (computeDriverStats) continue to show RAW top-3-avg with no
-- voids applied — voids affect placement, not the per-driver pace
-- surface. See Agents/TODO/Active/h6-race-kind-ranking.md.
ALTER TABLE rc_race_drivers
  ADD COLUMN voided_laps_count INTEGER NOT NULL DEFAULT 0 CHECK (voided_laps_count >= 0);
```

Idempotent via `schema_migrations` (same pattern as 0005). No data
migration in this file — that's Phase G (0007).

---

## Phase B — Shared placement helper

New file `lib/rc/placement.ts`:

```ts
export type RaceKind = 'practice' | 'qualif' | 'race';

export type PlacementInput = {
  driverId: string;
  lapsCompleted: number;
  bestLapMs: number | null;
  totalTimeMs: number;
  penaltyMs: number;
  voidedLapsCount: number;
  // Normal lap times sorted asc, with the first `voidedLapsCount`
  // entries already stripped. Used for top-3-avg ranking.
  rankingLapsAscMs: number[];
  transponderId: number;
};

// Sort normal lap times ascending, then skip the first N (voided)
// entries. Pure function. Used by both `comparePlacement` callers
// and the DB-side recompute in `lib/db/rc.ts`.
export function rankingLapTimes(
  normalLapTimesAscMs: number[],
  voidedLapsCount: number,
): number[] {
  if (voidedLapsCount <= 0) return normalLapTimesAscMs;
  return normalLapTimesAscMs.slice(voidedLapsCount);
}

export function comparePlacement(
  a: PlacementInput,
  b: PlacementInput,
  raceKind: RaceKind,
): number {
  if (raceKind === 'race') {
    if (a.lapsCompleted !== b.lapsCompleted) {
      return b.lapsCompleted - a.lapsCompleted;
    }
    const at = a.totalTimeMs + a.penaltyMs;
    const bt = b.totalTimeMs + b.penaltyMs;
    if (at !== bt) return at - bt;
    return a.transponderId - b.transponderId;
  }
  // qualif / practice: top-3-avg.
  const aHas3 = a.rankingLapsAscMs.length >= 3;
  const bHas3 = b.rankingLapsAscMs.length >= 3;
  if (aHas3 !== bHas3) return aHas3 ? -1 : 1;
  if (!aHas3) {
    // both have <3 ranking laps — best-lap ASC (null = last), transponder.
    const ab = bestOrInf(a.bestLapMs);
    const bb = bestOrInf(b.bestLapMs);
    if (ab !== bb) return ab - bb;
    return a.transponderId - b.transponderId;
  }
  const aAvg = (a.rankingLapsAscMs[0]! + a.rankingLapsAscMs[1]! + a.rankingLapsAscMs[2]!) / 3;
  const bAvg = (b.rankingLapsAscMs[0]! + b.rankingLapsAscMs[1]! + b.rankingLapsAscMs[2]!) / 3;
  if (aAvg !== bAvg) return aAvg - bAvg;
  const ab = bestOrInf(a.bestLapMs);
  const bb = bestOrInf(b.bestLapMs);
  if (ab !== bb) return ab - bb;
  if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
  return a.transponderId - b.transponderId;
}

function bestOrInf(x: number | null): number {
  return x == null ? Number.POSITIVE_INFINITY : x;
}
```

The helper is pure (no I/O). All sort decisions branch on `raceKind`
once at the top — keeps the cost simple to reason about.

---

## Phase C — Importer updates

`lib/rc/import.ts` and `lib/rc/import-txt.ts` both have an identically
shaped local `comparePlacement`. Both:

1. Drop the local function.
2. Import `{ comparePlacement, rankingLapTimes, PlacementInput }` from
   `lib/rc/placement.ts`.
3. Compute `PlacementInput[]` from the in-memory standings:
   ```ts
   const inputs: PlacementInput[] = [...standingsByDriverId.values()].map((s) => {
     const normalLapsAsc = sortedNormalLapTimes(s.driverId);
     return {
       driverId: s.driverId,
       lapsCompleted: s.lapsCompleted,
       bestLapMs: s.bestLapMs,
       totalTimeMs: s.totalTimeMs,
       penaltyMs: 0,
       voidedLapsCount: 0,
       rankingLapsAscMs: rankingLapTimes(normalLapsAsc, 0),
       transponderId: s.transponderId,
     };
   });
   inputs.sort((a, b) => comparePlacement(a, b, race.kind));
   ```
4. `sortedNormalLapTimes(driverId)` is a small local function that
   walks `race.drivers[idx].laps` (or the parsed TXT lap array) for
   `lap.kind === 'normal'`, maps to ms, and sorts asc. The data is
   already in memory at this point in the importer; no SQL.

The shape of `DriverStandings` stays internal to the importer
(`{ driverId, transponderId, lapsCompleted, bestLapMs, totalTimeMs }`)
— the new `rankingLapsAscMs` field lives on `PlacementInput`, which
is the importer→sort boundary.

---

## Phase D — `setDriverPenalty` recompute uses new helper

In `lib/db/rc.ts`, replace the SQL `ORDER BY` recompute inside
`setDriverPenalty` with a JS sort. The shape:

```ts
function recomputePlacements(db: Database.Database, raceId: string): void {
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

  const lapsStmt = db.prepare(
    `SELECT lap_time_ms FROM rc_laps
      WHERE race_id = ? AND driver_id = ? AND lap_kind = 'normal'
      ORDER BY lap_time_ms ASC`,
  );

  const inputs: PlacementInput[] = drivers.map((d) => {
    const lapRows = lapsStmt.all(raceId, d.driver_id) as Array<{ lap_time_ms: number }>;
    const normalAsc = lapRows.map((r) => r.lap_time_ms);
    return {
      driverId: d.driver_id,
      lapsCompleted: d.laps_completed,
      bestLapMs: d.best_lap_ms,
      totalTimeMs: d.total_time_ms,
      penaltyMs: d.penalty_ms,
      voidedLapsCount: d.voided_laps_count,
      rankingLapsAscMs: rankingLapTimes(normalAsc, d.voided_laps_count),
      transponderId: d.transponder_id,
    };
  });
  inputs.sort((a, b) => comparePlacement(a, b, race.race_kind));

  const setPlacement = db.prepare(
    `UPDATE rc_race_drivers SET placement = ? WHERE race_id = ? AND driver_id = ?`,
  );
  for (let i = 0; i < inputs.length; i++) {
    setPlacement.run(i + 1, raceId, inputs[i]!.driverId);
  }
}
```

`setDriverPenalty` then becomes:

```ts
export function setDriverPenalty(
  db: Database.Database,
  raceId: string,
  driverId: string,
  penaltyMs: number,
): { status: 'ok' } | { status: 'no_row' } | { status: 'invalid' } {
  if (!Number.isInteger(penaltyMs) || penaltyMs < 0) {
    return { status: 'invalid' };
  }
  const tx = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE rc_race_drivers SET penalty_ms = ? WHERE race_id = ? AND driver_id = ?`,
      )
      .run(penaltyMs, raceId, driverId);
    if (updated.changes === 0) return { status: 'no_row' as const };
    recomputePlacements(db, raceId);
    return { status: 'ok' as const };
  });
  return tx.immediate();
}
```

The two-statement pattern (UPDATE → recompute) is shared with
`setVoidedLapsCount` below.

---

## Phase E — New `setVoidedLapsCount`

```ts
export function setVoidedLapsCount(
  db: Database.Database,
  raceId: string,
  driverId: string,
  count: number,
): { status: 'ok' } | { status: 'no_row' } | { status: 'invalid' } {
  if (!Number.isInteger(count) || count < 0) {
    return { status: 'invalid' };
  }
  const tx = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE rc_race_drivers SET voided_laps_count = ? WHERE race_id = ? AND driver_id = ?`,
      )
      .run(count, raceId, driverId);
    if (updated.changes === 0) return { status: 'no_row' as const };
    recomputePlacements(db, raceId);
    return { status: 'ok' as const };
  });
  return tx.immediate();
}
```

Same shape as `setDriverPenalty` — only the column-name differs.
DB-level cap stays at "non-negative integer"; the upper bound
(`count <= 10`) lives at the API layer (Phase F).

---

## Phase F — API endpoint

`app/api/racing/races/[raceId]/drivers/[driverId]/route.ts` accepts
either `{ penalty_ms }` or `{ voided_laps_count }`:

```ts
const Body = z.union([
  z.object({ penalty_ms: z.number().int().min(0).max(599_999) }),
  z.object({ voided_laps_count: z.number().int().min(0).max(10) }),
]);
```

Logic:

1. Capture `placement_before` (existing pattern from H4).
2. Branch on which key is present:
   - `penalty_ms` → call `setDriverPenalty`.
   - `voided_laps_count` → call `setVoidedLapsCount`.
3. Capture `placement_after`.
4. Response shape:
   ```ts
   {
     status: 'ok',
     placement_before: number | null,
     placement_after: number | null,
     penalty_ms: number,           // current value after the mutation
     voided_laps_count: number,    // current value after the mutation
     adjusted_total_time_ms: number | null,
   }
   ```
   Both `penalty_ms` and `voided_laps_count` are returned regardless
   of which one was just changed — the client can echo state without
   refetching. The current values are read from the post-mutation
   `standingsForRace` row.

`canEditRace` gate unchanged. 401 / 403 / 404 / 400 envelope mirrors
the existing handler. 400 reason strings: `invalid penalty` /
`invalid voided_laps_count` (the zod error message is fine — the API
returns `{ error: 'invalid body' }` for malformed JSON).

---

## Phase G — Migration 0007 (data backfill)

`lib/db/migrations/0007_recompute_qualif_placement.sql`:

```sql
-- 0007_recompute_qualif_placement.sql — Recompute placement for all
-- existing practice + qualif rows using the new top-3-avg ranking.
-- race-kind rows are untouched. H6: see
-- Agents/TODO/Active/h6-race-kind-ranking.md.
--
-- Tiebreak deviation: SQL cannot easily reach transponder_id for
-- tiebreak among <3-lap drivers. We use driver_id ASC for determinism;
-- the JS-side recompute (lib/db/rc.ts) uses transponder_id ASC. If an
-- admin later touches a qualif/practice row via setVoidedLapsCount or
-- setDriverPenalty, the JS recompute fires and picks up the proper
-- transponder tiebreak.

WITH ranked_laps AS (
  SELECT rd.race_id, rd.driver_id, l.lap_time_ms,
         ROW_NUMBER() OVER (
           PARTITION BY rd.race_id, rd.driver_id
           ORDER BY l.lap_time_ms ASC
         ) AS rk
    FROM rc_race_drivers rd
    JOIN rc_races r ON r.id = rd.race_id AND r.race_kind IN ('practice','qualif')
    JOIN rc_laps   l ON l.race_id = rd.race_id
                    AND l.driver_id = rd.driver_id
                    AND l.lap_kind = 'normal'
),
top3 AS (
  SELECT race_id, driver_id,
         AVG(lap_time_ms) AS top3_avg_ms,
         COUNT(*)         AS n_laps,
         MIN(lap_time_ms) AS best_lap_ms
    FROM ranked_laps
   WHERE rk BETWEEN 1 AND 3
   GROUP BY race_id, driver_id
),
ranked AS (
  SELECT race_id, driver_id,
         ROW_NUMBER() OVER (
           PARTITION BY race_id
           ORDER BY
             CASE WHEN n_laps >= 3 THEN 0 ELSE 1 END,
             top3_avg_ms ASC,
             best_lap_ms ASC,
             driver_id ASC
         ) AS new_placement
    FROM top3
)
UPDATE rc_race_drivers
   SET placement = COALESCE(
         (SELECT new_placement FROM ranked
           WHERE ranked.race_id   = rc_race_drivers.race_id
             AND ranked.driver_id = rc_race_drivers.driver_id),
         placement
       )
 WHERE EXISTS (
   SELECT 1 FROM rc_races r
    WHERE r.id = rc_race_drivers.race_id
      AND r.race_kind IN ('practice','qualif')
 );
```

Notes:

- SQLite has window functions since 3.25 (2018). The eloup-web
  container's better-sqlite3 ships a recent build.
- The `top3` CTE only includes drivers who have ≥1 normal lap (the
  JOIN to `rc_laps` filters). Drivers with zero normal laps keep
  their existing `placement` via the `COALESCE` — they're already at
  the bottom of the import-time order anyway.
- The `n_laps >= 3` branch in the `ORDER BY` mirrors the JS sort's
  "sinks to bottom" rule for <3-lap drivers.
- Idempotent: the migration runs once per `schema_migrations`. If an
  admin later changes a row, the JS-side recompute fires (per
  `setVoidedLapsCount` / `setDriverPenalty`).

---

## Phase H — `RaceAdminPanel` UI

Changes to `components/RaceAdminPanel.tsx`:

1. New prop on the parent component:
   ```ts
   raceKind: 'race' | 'practice' | 'qualif';
   ```
   Plus `voidedLapsCount: number` on each driver in the `drivers` array.

2. The "Apply penalty" sub-section's per-row render branches on
   `raceKind`:
   - `raceKind === 'race'` → existing penalty input (seconds, +0/.1
     step). Save fires PATCH with `{ penalty_ms }`.
   - `raceKind === 'practice' \|\| 'qualif'` → "Void laps" stepper
     (`<input type="number" inputmode="numeric" min="0" max="10"
     step="1">`). Save fires PATCH with `{ voided_laps_count }`.

3. Hint copy (folds the new behavior into the existing PenaltyRow
   hint slot):
   - `race`, penalty changed, placement unchanged → "Position
     unchanged — driver completed more laps" (existing copy).
   - `qualif` / `practice`, voided_laps_count changed, placement
     unchanged → "Position unchanged — ranking uses top-3 avg of
     remaining laps".
   - (Defer the "Penalty applied for record only" copy until /
     unless we expose a penalty input on qualif/practice rows. H6
     hides the penalty input on qualif/practice — see decision Q-H6-5
     — so this third copy is not reachable from the UI today. The
     DB still accepts it via the API for admin scripting.)

4. Standings table on `app/racing/[raceId]/page.tsx` for qualif /
   practice races: show a "Top-3 avg" column derived from the
   post-void ranking laps (i.e., the value used for ranking, not the
   raw `computeDriverStats` top3AvgMs). Server-side, compute this
   alongside the other standings fields and pass into the page. The
   existing "Total" column stays for now (it's still meaningful as a
   session duration). For `race` kind the table is unchanged.

5. The standings row's "Voided" column appears only on qualif/practice
   when any driver has `voided_laps_count > 0` (parallel to the
   existing `hasPenalty` footnote). Shows `-N laps` in amber.

---

## Phase I — Tests

Vitest, ephemeral SQLite per file (no DB mocks). Target ~18–25 tests.

### Unit (`tests/unit/`)

`rc-placement.test.ts` (new):

1. `rankingLapTimes(asc, 0)` returns the input unchanged.
2. `rankingLapTimes(asc, 1)` drops the first (fastest) entry.
3. `rankingLapTimes(asc, n >= length)` returns `[]`.
4. `comparePlacement` race-kind: laps tiebreak picks higher laps.
5. `comparePlacement` race-kind: ties on laps → adjusted total ASC.
6. `comparePlacement` race-kind: ties on laps + adjusted total →
   transponder ASC.
7. `comparePlacement` qualif: top-3-avg ASC.
8. `comparePlacement` qualif: ties on top-3-avg → best-lap ASC.
9. `comparePlacement` qualif: ties on top-3-avg + best-lap →
   laps_completed DESC.
10. `comparePlacement` qualif <3 laps: 3-lap driver beats 2-lap
    driver regardless of times.
11. `comparePlacement` qualif both <3 laps: best-lap ASC, null = last.
12. `comparePlacement` qualif both <3 laps + tied best-lap →
    transponder ASC.
13. `comparePlacement` qualif voided_laps shifts picked laps: same
    raw top-3 but one driver voids the fastest → other driver wins.
14. `comparePlacement` practice (same shape as qualif) — one-line
    test pinning the race-kind branch.

`rc-admin-edits.test.ts` (edit):

15. `setVoidedLapsCount` happy: writes the value, placement
    recomputes. Pre/post placement assertions on a known qualif
    fixture.
16. `setVoidedLapsCount` invalid: negative count → `invalid`. No
    row touched.
17. `setVoidedLapsCount` invalid: non-integer (e.g. 1.5) → `invalid`.
18. `setVoidedLapsCount` no_row: unknown (race, driver) → `no_row`.
19. `setVoidedLapsCount` placement reorders: qualif race where
    voiding the leader's fastest lap drops them to 2nd.
20. `setVoidedLapsCount(db, raceId, driverId, 11)` → still `ok` at
    the DB layer (the API enforces the upper bound; the DB function
    accepts any non-negative integer). Pins the DB-vs-API
    responsibility split.

### Integration (`tests/integration/`)

`rc-admin-edits.test.ts` (edit):

21. PATCH `{ voided_laps_count: 1 }` happy → 200, response includes
    `placement_before` and `placement_after` as numbers,
    `voided_laps_count === 1`.
22. PATCH `{ voided_laps_count: 11 }` → 400 (over cap).
23. PATCH `{ voided_laps_count: -1 }` → 400 (zod min).
24. PATCH `{ voided_laps_count: 1 }` with 401 / 403 envelope.
25. PATCH with both fields `{ penalty_ms, voided_laps_count }` → 400
    (zod union rejects extra keys via `.strict()` — confirm with the
    zod docs at implementation; if not strict by default, pick the
    first matching branch and let the other key be ignored — but
    document the chosen behavior).

`rc-import.test.ts` (edit):

26. Import a qualif fixture (or modify an existing one to set
    `kind: 'qualif'`); assert standings placement matches top-3-avg
    ordering. Race-kind imports are unchanged.

`rc-backfill-0007.test.ts` (new):

27. Seed a practice race with 4 drivers having known lap times that
    produce a different placement under top-3-avg vs. laps + total.
    Run migrations. Assert placements match the top-3-avg order.
28. Migration 0007 is idempotent: running migrations twice yields
    the same placements.
29. `race`-kind rows are untouched by 0007: seed a race-kind race
    alongside the practice race; capture race-kind placements
    pre-migration; assert they are identical post-migration.

`migrate.test.ts` (edit):

30. Running migrate twice doesn't re-add `voided_laps_count` (column
    count unchanged on second run).
31. Fresh DB has `voided_laps_count` with default 0.

### Test count

~20 new + 3 edits = roughly 23 net new test cases. Slightly above
the ~18 floor of the prompt's target, comfortably under the 25
ceiling.

---

## Three must-work flows

### Flow 1 — Fresh qualif import

Operator uploads a qualif JSON via `/racing/upload`. The importer
parses, computes per-driver `bestLap`, `lapsCompleted`,
`totalTimeMs`, plus the new `rankingLapsAscMs` (= normal lap times
sorted asc). Builds `PlacementInput[]`, calls
`comparePlacement(a, b, 'qualif')`. Inserts `rc_race_drivers` rows
with `placement` reflecting top-3-avg order. The race-detail page
renders the standings in that order. The lap chart and per-driver
stats are unchanged (they show raw top3AvgMs from
`computeDriverStats`).

### Flow 2 — Jump-start void

Operator opens the qualif race detail page as `global_admin`. The
Admin section shows a "Void laps" stepper for each driver (instead
of the seconds input). For the jump-starter, they bump the stepper
to 1 and tap Save. Client POSTs `{ voided_laps_count: 1 }`. Server
captures `placement_before`, calls `setVoidedLapsCount`, which writes
the column and recomputes placement (skipping the driver's fastest
lap from their top-3-avg). The penalized driver drops one slot. The
PATCH returns `{ placement_before: 1, placement_after: 2,
voided_laps_count: 1, penalty_ms: 0, adjusted_total_time_ms: ... }`.
The standings table re-renders. The `computeDriverStats` grid below
still shows the driver's raw top-3-avg — stats stay true to the data.

### Flow 3 — Backfill for existing qualif rows

Operator deploys H6. Migration 0006 adds the column. Migration 0007
runs once and recomputes placement for every existing
practice/qualif `rc_race_drivers` row. Every old qualif race in the
DB now shows top-3-avg-ranked standings on the race-detail page.
Existing `race`-kind rows are untouched (`placement` is identical
pre- and post-migration for them).

---

## Recommended interaction: penalty + void in qualif

If an admin sets BOTH `penalty_ms > 0` AND `voided_laps_count > 0`
on a qualif row, the placement-recompute only honors the void (per
Q-H6-4). The `penalty_ms` is preserved as record-of-the-decision but
has no ranking effect. The admin UI does not surface this
combination — the operator picks one mechanism per kind, and
race-kind shows penalty while qualif/practice shows voids. An
operator scripting against the API directly can still set both; the
DB enforces neither field's interaction.

This is the simplest semantics that keeps every column meaningful
and avoids invent-a-tier "penalty-time AND penalty-laps" composition.
Multi-tier composition is explicitly out of scope per the prompt.

---

## Out of scope for H6 (do NOT build)

- **Multi-tier penalties** combining penalty time + voided laps in a
  single UI affordance. Admin can set both fields independently via
  the API if desired; no combined UI.
- **Best-lap strikethrough on the LapChart for voided laps.** Defer
  to H7 (chart-side visual cue for voided laps).
- **Multi-track / multi-race qualif standings** (cross-race top-3-avg).
  H6 is per-race.
- **Wizard changes.**
- **Symbol changes** (per Q-H6-13).
- **Changing `computeDriverStats` to apply voids.** Per Q-H6-7, stats
  stay true to the data — voids affect placement, not the per-driver
  pace surface.
- **Recomputing placement of `race`-kind rows in 0007.** Out of scope
  per Q-H6-6.

---

## Quality bar

- No comments unless WHY is non-obvious. The `recomputePlacements`
  primitive's "JS-sort-replaces-SQL-ORDER-BY" rationale is worth one
  comment.
- No mocks at the DB boundary. Ephemeral SQLite per test file.
- TypeScript strict; no `any` without a `// reason:` line.
- ESLint + Prettier + typecheck + build clean.
- Mobile-first: void-laps stepper keeps the existing 44px tap target.
  Both penalty input and void stepper are `type="number"` with
  `inputmode` appropriate for the keyboard (`decimal` for seconds,
  `numeric` for integer voids).

---

## Verification

After implementation lands:

1. `python3 scripts/align.py check` exits 0. No symbol change.
2. `cd wizard && python3 -m pytest -q` — still 104 passing. H6 makes
   zero wizard edits.
3. `cd eloup-web && pnpm test && pnpm lint && pnpm typecheck && pnpm build` clean.
4. `docker build -f Dockerfile.eloup-web .` succeeds.
5. **Do NOT run the wizard. Do NOT push to remote. Do NOT call any
   prod API.**

---

## Commit shape

Six commits expected (mirrors H5 discipline):

1. `docs: H6 — race-kind ranking task doc` — this file only.
   **STOP after this commit and request review.**
2. `docs: H6 — reviewer report` — landed by a different agent in
   `Agents/Review-reports/h6-race-kind-ranking-review.md` referencing
   this filename.
3. `docs: H6 — fold reviewer findings, flip task to In Progress` —
   ONLY if review flags MAJOR-grade changes that require a doc
   update before implementation. Otherwise skip and absorb the
   reviewer's notes inline in commit 4.
4. `feat: eloup-web — race-kind-aware ranking + void-laps action` —
   Phases A–F + I (tests). Migration 0006, shared placement helper,
   importer + DB recompute, API extension, RaceAdminPanel UI, tests.
5. `feat: eloup-web — qualif/practice placement backfill` (Phase G) —
   migration 0007 + the backfill integration test. Implementer's
   call to fold into commit 4 if the diff stays manageable.
6. `docs: H6 — mark task Complete` — flip Status, verification
   results in the commit body.

Each commit ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Hand-offs

After H6 ships, the following follow-ups are natural but deferred:

- **H7 — Lap chart visual indication of voided laps.** Strike or
  fade the N fastest laps in the per-driver lap-by-lap table and on
  the chart. Out of scope for H6.
- **Cross-race qualif aggregation.** When the operator runs multiple
  qualif heats and wants an overall best-laps leaderboard (e.g.,
  "across the three qualifying sessions, who had the best top-3-avg
  across all laps?"). Bigger feature; deferred.
- **Multi-tier penalty UI.** A combined "void N laps + add Ts of
  penalty time" affordance. The DB already supports it; only the UI
  is missing.
- **`computeDriverStats` mode flag.** If a future surface wants to
  show the post-void top-3-avg (e.g., on the driver profile to
  reflect what was used for ranking), add an optional
  `voidedLapsCount` param to `computeDriverStats`. H6 keeps the stats
  helper void-blind by design.
- **ELO integration of qualif placements.** R2 (RC ELO) currently
  reads `placement` straight off `standingsForRace`. With H6,
  `placement` for qualif/practice reflects top-3-avg + voids —
  R2's contract is unchanged.

---

## Clarifying questions surfaced while writing this doc

Flagging for the reviewer:

1. **Should the standings table on qualif/practice race-detail pages
   show "Top-3 avg" instead of (or alongside) "Total"?** The current
   plan keeps "Total" and adds a "Top-3 avg" column derived from the
   ranking laps. Showing both gives the operator a sense of session
   length plus the ranking primitive. Switching "Total" out entirely
   for qualif/practice is also defensible — Total is rarely
   meaningful for a practice session. Leaning toward "keep both";
   reviewer's call.

2. **Zod union rejecting extra keys.** Zod's `z.object` is by
   default permissive (extra keys allowed). For PATCH with both
   `penalty_ms` AND `voided_laps_count` in the body, the union would
   pick the first matching branch (`penalty_ms`) and silently ignore
   `voided_laps_count`. Tightening this with `.strict()` on each
   branch turns the conflict into a 400. I lean `.strict()` because
   "submitted both, only one applied" is a bug-magnet. Reviewer's
   call.

3. **`PlacementInput.bestLapMs` source for `race` kind.** In `race`
   kind the field is unused by `comparePlacement` (laps + adjusted
   total + transponder decide everything). I still compute and pass
   it for shape uniformity. Reviewer can push to make it optional,
   but I lean "compute it once, always pass it" to avoid two shapes.

4. **Migration 0007 deterministic tiebreak deviation.** The SQL uses
   `driver_id ASC` for <3-lap tiebreak instead of `transponder_id
   ASC`. Documented in the migration comment. If a reviewer wants
   exact parity, the migration would need a JOIN to
   `rc_race_drivers.transponder_id` in the `ORDER BY` — I'm fine
   adding that if the reviewer prefers strict parity. The downside
   is the JOIN noise for a one-time-only migration that only deals
   with a few hundred rows.

5. **`computeDriverStats` parameter for voids.** The prompt
   recommends adding a separate `topNAvgSkippingVoid` helper. I'm
   landing the per-driver ranking computation inside the importer +
   DB recompute via the shared `rankingLapTimes(laps, voided)` —
   `computeDriverStats` stays untouched. If the reviewer prefers an
   explicit `topNAvgSkippingVoid` export from `lib/rc/stats.ts` for
   symmetry, happy to add.

6. **Should H6 also surface `voided_laps_count` on the existing
   standings table for `race`-kind races?** The field is non-zero
   only if an operator deliberately scripted it via the API for a
   race-kind row. The plan keeps the column hidden on race-kind
   render; reviewer can push to always show. Leaning hidden — it'd
   be noise for race kind where the operator uses penalty_ms.
