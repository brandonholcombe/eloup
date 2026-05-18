# H2 — Race admin edits: track reassignment + penalty time

## Author: claude-opus-4.7-h2-implementer
## Status: In Progress

> **Reviewer fold (2026-05-17).** `claude-sonnet-4-6-h2-reviewer`
> approved with changes in
> `Agents/Review-reports/h2-race-admin-edits-review.md`. The load-bearing
> deltas are folded into this doc below. The four clarifying questions
> at the bottom of the doc are answered by the reviewer's "Positions on
> the four flagged questions" section and adopted verbatim.
>
> Folded changes:
>
> 1. **MAJOR-1** — `setDriverPenalty` uses `db.transaction(...).immediate()`
>    (not deferred `tx()`) to match `lib/rc/import.ts:198`. Code sample
>    below updated.
> 2. **MAJOR-2** — `lib/rc/tracks.ts`'s shared `createTrack` adds a
>    case-insensitive name short-circuit: `SELECT id FROM rc_tracks
>    WHERE lower(name) = lower(?)` before `slugify + withSuffix`. If a
>    row matches, that ID is returned and `matched: true` flows up to
>    the PATCH route's 200 body. Prevents "Outdoor Long" / "outdoor
>    long" silent duplicates from a fat-finger.
> 3. **MINOR-3** — Cross-commit dependency: `RcStandingRow` type +
>    `standingsForRace` SELECT MUST land together in commit 3.
>    `page.tsx`'s use of `s.adjusted_total_time_ms` in commit 4 depends
>    on it.
> 4. **MINOR-5** — Add a slug-collision unit test for `createTrack`.
> 5. **MINOR-6** — Add a `setDriverPenalty(db, ..., 600000) → ok`
>    unit-test assertion to pin the DB-vs-API responsibility split.
> 6. **NIT-7** — Footnote "Total includes penalty." renders only when
>    `standings.some(s => s.penalty_ms > 0)`.
> 7. **Tie-edge case** — Add a unit test for two drivers whose
>    `total_time_ms + penalty_ms` tie after penalty; tiebreak falls to
>    `transponder_id ASC`.
> 8. **Hand-offs (MINOR-4)** — `recentRacesForDriver` still returns
>    raw `total_time_ms`; R2 should update the SELECT to return
>    `total_time_ms + penalty_ms AS adjusted_total_time_ms` and update
>    the driver profile display.
>
> The `setDriverPenalty` upper-bound cap stays at the API layer
> (`max(599_999)`); the DB function accepts any non-negative integer.

> **Author/Reviewer separation note.** Prior implementers are
> `claude-opus-4.7-{planner,m2,m3,m4,m5,h1,r1}-implementer`; prior
> reviewers are `claude-sonnet-4-6-{m2,m3,m4,m5,h1,r1}-reviewer`. The
> reviewer for this doc must use a `## Reviewer:` field distinct from
> `## Author: claude-opus-4.7-h2-implementer`. Suggested:
> `claude-sonnet-4-6-h2-reviewer`.
>
> The reviewer should land their report at
> `Agents/Review-reports/h2-race-admin-edits-review.md` referencing
> `h2-race-admin-edits.md` in the body. Until then, the review gate
> blocks edits to `eloup-web/`.

---

## Why this task exists

R1 shipped the RC racing surface: anyone uploads a Lap Monitor JSON,
the importer maps each `race.uuid` → `rc_races` row, derives placements
from lap data, and freezes them in `rc_race_drivers`. Two real-world
corrections aren't yet possible:

1. **Wrong-track imports.** The original R1 plan was for the importer
   to read a track field from the JSON — but Lap Monitor exports don't
   carry a track field, so R1 pivoted to "operator picks track at
   upload time" (per R1 Q-R1-3). When the operator picks the wrong
   track (or fat-fingers the "new track" input creating a typo'd
   track), every race in that batch lands under the wrong slug. Today
   the only recovery is a manual SQL UPDATE in the pod.

2. **Race-day penalties.** Standard RC officiating: a jump start,
   illegal contact, off-track shortcut, or DNF-but-was-running adds
   +5s / +10s / etc. to a driver's total time, which can re-order the
   standings. R1 has no concept of a penalty — placements come straight
   from raw lap data.

Both bundle naturally: same audience (global_admin only), same surface
(`/racing/[raceId]`), same shape (admin-only inline controls beneath
the standings table). One sub-agent ships both as H2.

---

## Decisions (already locked in by the operator)

| # | Question | Decision | Why |
|---|---|---|---|
| Q-H2-1 | Penalty unit on the wire | **`penalty_ms` end-to-end** | Matches every other `*_ms` column in `rc_*`. UI accepts seconds for input ergonomics; the client converts (`Math.round(seconds * 1000)`) before POST. |
| Q-H2-2 | Penalty range | **`0 ≤ penalty_ms < 600000`** (10 minutes) | Non-negative — admins can't *reward* with a negative penalty; they reset to 0 to undo. 10 minutes is a fat-finger guard; values larger almost always mean a typo (e.g. typed seconds into the ms field). DB CHECK enforces non-negativity; API enforces the upper bound and returns 400 above it. |
| Q-H2-3 | Track-change with new track name | **Auto-create the `rc_tracks` row** | Mirrors the importer's existing `createTrack` helper in `app/api/racing/import/route.ts:56`. Uses the same `slugify` + `withSuffix` collision handling. |
| Q-H2-4 | Should the OLD track be auto-deleted when it ends up with zero races? | **No.** | Preserve admin history. An empty track row is harmless; cleanup is a separate concern (see Hand-offs at the bottom). Removing it would also require ON DELETE handling we don't want to bake in now. |
| Q-H2-5 | Who can edit? | **`global_admin` only** (no tournament_admin equivalent for RC racing yet) | Penalty + track change are admin-discretionary; the RC domain has no tournament scoping, and there's no per-track admin role. Matches R1's `canUploadRaceResults` shape. |
| Q-H2-6 | Permission helper shape | **`canEditRace(s)`** | Same shape as `canCreateGame` / `canUploadRaceResults`. The "race" noun makes the helper apply equally to the future "edit lap times" / "remove driver" expansions if/when they happen. |
| Q-H2-7 | Track-change semantics: idempotency anchor | **`rc_races.lap_monitor_uuid` stays the unique key** | Importer's idempotency hinges on `(lap_monitor_uuid)`; changing `rc_races.track_id` post-import doesn't break the dedupe key. Confirmed by reading `lib/rc/import.ts:89` and `0003_rc_racing.sql:26`. A subsequent re-upload of the same JSON to a different track still returns `duplicateRaces: <count>` — the existing row (now on the new track) wins. |
| Q-H2-8 | Standings recompute scope | **Per-race only, on penalty mutation, in the same transaction** | Placement is stored on `rc_race_drivers`. Changing one driver's `penalty_ms` can flip the order; recomputing in the same tx keeps the row consistent with what the standings query returns. Track change does NOT affect placements (per-race ordering doesn't depend on track). |
| Q-H2-9 | Effect on lap chart / per-driver pace stats | **None — penalty is total-time-only** | `rc_laps` rows are unchanged. `computeDriverStats`, `LapChart`, and the lap-by-lap table all operate on `rc_laps.lap_time_ms` which carries no penalty. The standings table is the only surface where penalty surfaces. Documented so the reviewer doesn't ask. |
| Q-H2-10 | UI placement | **Inline admin section between standings and lap-by-lap, render gated on `session.user.role === 'global_admin'`** | Same pattern as H1's `/profile` "Admin" section. The admin chip in `adminNavLinks` already covers cross-page navigation to admin tools (Games, Upload Race); race-edit is *contextual* to a specific race and belongs inline rather than as another global chip. |

---

## Schema delta — migration `0005_rc_penalty.sql`

```sql
-- 0005_rc_penalty.sql — Per-driver penalty time (in ms) added to total time.
-- H2: admin-discretionary penalty for jump starts, illegal contact, etc.
-- Non-negative: admins clear a penalty by setting it back to 0, not by
-- entering a negative offset. The application-level cap (< 600000ms /
-- 10 minutes) is enforced at the API boundary; the DB CHECK only guards
-- the sign. See Agents/TODO/Active/h2-race-admin-edits.md.

ALTER TABLE rc_race_drivers
  ADD COLUMN penalty_ms INTEGER NOT NULL DEFAULT 0 CHECK(penalty_ms >= 0);
```

**Notes:**

- SQLite's `ALTER TABLE ADD COLUMN` with `NOT NULL DEFAULT 0` is
  well-supported (since v3.32). Existing rows back-fill to 0.
- One new column. No new tables. No FK changes. No index — penalty is
  always read alongside the row that carries it.
- Idempotent via `schema_migrations` (same pattern as 0004).
- No backfill needed beyond the literal `DEFAULT 0` — existing races
  have zero penalties by definition.

---

## Files I'll change

Under `eloup-web/`:

| File | Status | Change |
|---|---|---|
| `lib/db/migrations/0005_rc_penalty.sql` | new | The ALTER above. |
| `lib/db/rc.ts` | edit | (1) Add `penalty_ms` + `adjusted_total_time_ms` to `RcStandingRow`. (2) Update `standingsForRace` to SELECT and ORDER BY adjusted total. (3) Add `setRaceTrack(db, raceId, trackId)`. (4) Add `setDriverPenalty(db, raceId, driverId, penaltyMs)` that does the UPDATE + recomputes placements in the same transaction. |
| `lib/permissions.ts` | edit | Add `canEditRace(s)` — global_admin only. |
| `app/api/racing/races/[raceId]/route.ts` | new | `PATCH` — body `{ trackId: string } \| { trackName: string }`. Auto-creates the track when `trackName` is given and no match exists. 401 / 403 / 404 / 400 shapes. |
| `app/api/racing/races/[raceId]/drivers/[driverId]/route.ts` | new | `PATCH` — body `{ penalty_ms: number }`. Validates non-negative integer < 600000. Same auth shape. |
| `app/racing/[raceId]/page.tsx` | edit | Render an `<RaceAdminPanel>` between standings and lap-by-lap, gated on session role. Update the standings table: add a "Penalty" column between "Best" and "Total"; "Total" now shows the adjusted total; add a footnote "Total includes penalty." |
| `components/RaceAdminPanel.tsx` | new | Client component. Top: track picker (dropdown of existing tracks + a "new track…" option that reveals an input). Bottom: a small table mirroring the standings — driver name, current penalty in seconds (editable), Save button per row. Inline errors. 44×44 tap targets; `type=number inputmode=decimal` on the penalty input for iOS. |
| `tests/integration/rc-admin-edits.test.ts` | new | Full round-trip: apply penalty → assert `adjusted_total_time_ms` reflects it → placements reordered. Track change updates `rc_races.track_id` and removes the race from the old-slug leaderboard while adding it to the new. |
| `tests/integration/rc-import.test.ts` | edit | Add a regression assertion that `penalty_ms = 0` after a fresh import. |
| `tests/unit/rc-permissions.test.ts` | edit | Add `canEditRace` cases (user / tournament_admin / global_admin / null). |
| `tests/unit/rc-admin-edits.test.ts` | new | Unit-level: `setRaceTrack` happy path + idempotent re-call + no_race + no_track; `setDriverPenalty` happy path, penalty_ms=0 clears (no-op order), invalid (negative) rejected, the placement recompute order matches `comparePlacement`. |
| `tests/unit/migrate.test.ts` | edit | Add a 0005 idempotency case (run migrate twice; assert the column count of `rc_race_drivers` is unchanged on the second run and `penalty_ms` exists with default 0 on a fresh DB). |

Out of `eloup-web/`: no symbol changes, no docs changes, no wizard
changes. H2 doesn't shift the `racing` symbol's properties — it's still
display-driven, admin-uploaded, anonymous-readable. The new admin
editability is an admin-only extension consistent with `upload_role:
global_admin`.

---

## Phase A — Migration 0005

The ALTER above. One file. Tested via `tests/unit/migrate.test.ts`'s
existing idempotency harness.

## Phase B — `lib/db/rc.ts`

### `setRaceTrack(db, raceId, trackId): { status: 'ok' } | { status: 'no_race' } | { status: 'no_track' }`

```ts
export function setRaceTrack(
  db: Database.Database,
  raceId: string,
  trackId: string,
): { status: 'ok' } | { status: 'no_race' } | { status: 'no_track' } {
  const race = db.prepare(`SELECT id FROM rc_races WHERE id = ?`).get(raceId) as
    | { id: string }
    | undefined;
  if (!race) return { status: 'no_race' };
  const track = db.prepare(`SELECT id FROM rc_tracks WHERE id = ?`).get(trackId) as
    | { id: string }
    | undefined;
  if (!track) return { status: 'no_track' };
  db.prepare(`UPDATE rc_races SET track_id = ? WHERE id = ?`).run(trackId, raceId);
  return { status: 'ok' };
}
```

Idempotent — re-running with the same `trackId` is a no-op
(`UPDATE … = same value` writes one row of the same content; semantically
nothing changes downstream).

### `setDriverPenalty(db, raceId, driverId, penaltyMs): { status: 'ok' } | { status: 'no_row' } | { status: 'invalid' }`

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

    // Re-derive placements in the same tx. Ordering matches the
    // importer's comparePlacement: laps DESC, adjusted total ASC,
    // transponder ASC. Keeping the two paths aligned avoids drift.
    const rows = db
      .prepare(
        `SELECT driver_id, laps_completed,
                (total_time_ms + penalty_ms) AS adjusted_total_time_ms,
                transponder_id
           FROM rc_race_drivers
          WHERE race_id = ?
          ORDER BY laps_completed DESC,
                   adjusted_total_time_ms ASC,
                   transponder_id ASC`,
      )
      .all(raceId) as Array<{ driver_id: string }>;

    const setPlacement = db.prepare(
      `UPDATE rc_race_drivers SET placement = ? WHERE race_id = ? AND driver_id = ?`,
    );
    for (let i = 0; i < rows.length; i++) {
      setPlacement.run(i + 1, raceId, rows[i]!.driver_id);
    }
    return { status: 'ok' as const };
  });
  return tx.immediate();
}
```

The CHECK constraint already catches negatives at the DB level — the
explicit `Number.isInteger / >= 0` guard at the top of the function
gives a clean `invalid` return instead of a thrown SQLite error, and
the upper bound (`< 600000`) is enforced at the API boundary, not in
the DB function (the DB function is the lower-level primitive — a
unit test can drive a 700000ms penalty into it and expect ok, while
the API rejects it as a fat-finger guard).

### `standingsForRace`

```ts
export type RcStandingRow = {
  driver_id: string;
  display_name: string;
  player_id: string | null;
  transponder_id: number;
  placement: number;
  laps_completed: number;
  best_lap_ms: number | null;
  total_time_ms: number;
  penalty_ms: number;             // NEW
  adjusted_total_time_ms: number; // NEW: total_time_ms + penalty_ms
};
```

```sql
SELECT rd.driver_id, d.display_name, d.player_id, rd.transponder_id, rd.placement,
       rd.laps_completed, rd.best_lap_ms, rd.total_time_ms,
       rd.penalty_ms,
       rd.total_time_ms + rd.penalty_ms AS adjusted_total_time_ms
  FROM rc_race_drivers rd
  JOIN rc_drivers d ON d.id = rd.driver_id
 WHERE rd.race_id = ?
 ORDER BY rd.placement
```

Order by stored `placement` — kept in sync by `setDriverPenalty`'s
recompute. Reads are cheap; mutations are the slow path.

## Phase C — Permissions + API

### `canEditRace(s)`

```ts
export function canEditRace(s: SessionPlayer | null): boolean {
  return s?.role === 'global_admin';
}
```

Same shape as `canCreateGame` / `canUploadRaceResults`.

### `PATCH /api/racing/races/[raceId]`

Body validated with zod:

```ts
const TrackChangeBody = z.union([
  z.object({ trackId: z.string().min(1) }),
  z.object({ trackName: z.string().min(1).max(120) }),
]);
```

Behavior:

- 401 if no session.
- 403 if `!canEditRace(session.user)`.
- Parse body → 400 on invalid.
- `trackName` path: reuse the same `createTrack(db, name)` helper
  pattern that `app/api/racing/import/route.ts` uses (slugify +
  withSuffix collision loop). Extract it to `lib/rc/tracks.ts` so
  both routes import the same function (one source of truth for the
  auto-create semantics).
- `trackId` path: hand the ID straight to `setRaceTrack`.
- Map `setRaceTrack` return: `ok` → 200; `no_race` → 404;
  `no_track` → 400 with reason.
- Response shape: `{ status: 'ok', trackId: string }`.

### `PATCH /api/racing/races/[raceId]/drivers/[driverId]`

```ts
const PenaltyBody = z.object({
  penalty_ms: z.number().int().min(0).max(599_999),
});
```

`max(599_999)` enforces the operator's "<10 minutes" cap; values at or
above 600000 return 400. Same 401 / 403 envelope as the track route.
404 when the `(race, driver)` row doesn't exist (i.e. `setDriverPenalty`
returned `no_row`).

Response shape: `{ status: 'ok', placement: number, adjusted_total_time_ms: number }`
so the client can echo the new state without a refetch.

## Phase D — UI

### `app/racing/[raceId]/page.tsx`

- Top of the file: call `auth()` to get the session.
- Pass `session?.user?.role` into `<RaceAdminPanel>`, but conditionally
  render the section only when `role === 'global_admin'`.
- Pass `listTracks(handle)` alongside the race + standings.
- Standings table changes:
  - New column "Penalty" between "Best" and "Total".
  - Show `+${(s.penalty_ms / 1000).toFixed(1)}s` in `text-amber-400`
    when `penalty_ms > 0`, `—` otherwise.
  - "Total" column now shows `formatLapMs(s.adjusted_total_time_ms)`.
  - Footnote under the table: `Total includes penalty.`
- Section ordering becomes: header → chart → standings → **Admin** (if
  global_admin) → Lap-by-lap.

### `components/RaceAdminPanel.tsx`

Client component, `'use client'`. Receives:

```ts
{
  raceId: string;
  currentTrackId: string;
  currentTrackName: string;
  tracks: Array<{ id: string; name: string }>;
  drivers: Array<{
    driverId: string;
    displayName: string;
    penaltyMs: number;
  }>;
}
```

UI:

- A bordered section, `<h2>Admin</h2>` plus a small subtitle.
- **Track picker**: `<select>` of all tracks (existing one selected) +
  an "Add new track…" option that reveals a `<input type="text">`
  with `maxLength=120`. Save button. Inline error rendered next to
  the select.
- **Penalty rows**: small table mirroring standings columns: driver
  name, current penalty in seconds (`<input type="number" step="0.1"
  inputmode="decimal" min="0" max="599.999">`), Save button per row.
  Inline per-row error.
- Each Save button: POSTs the relevant PATCH, on success calls
  `router.refresh()` to re-render the server component with fresh
  data. On error, render the response's `reason` inline.
- Tap targets: `min-h-tap` on every interactive control (matches the
  H1 pattern).

## Phase E — Tests

Vitest, per the M4/M5/R1 pattern. Ephemeral SQLite via the same
`mkdtempSync`/`applyMigrations` harness used by every other integration
test under `tests/integration/`. No DB mocks.

### Unit (`tests/unit/`)

- `rc-admin-edits.test.ts` (new):
  - `setRaceTrack` happy path — UPDATE flips the row's `track_id`.
  - `setRaceTrack` idempotency — calling it twice with the same id is
    fine; no error, no extra changes.
  - `setRaceTrack` returns `no_race` for a missing race id.
  - `setRaceTrack` returns `no_track` for a missing track id.
  - `setDriverPenalty` happy path — UPDATE writes the value; standings
    show the new `adjusted_total_time_ms`.
  - `setDriverPenalty` with `penalty_ms = 0` is a no-op for placement
    when all penalties are zero (regression for the "doesn't reorder
    needlessly" property — the recompute is deterministic, but order
    should equal the import order under zero penalties).
  - `setDriverPenalty` rejects negative penalty with `invalid`.
  - `setDriverPenalty` returns `no_row` for an unknown (race, driver).
  - `setDriverPenalty(db, raceId, driverId, 600000)` → `ok` (pins the
    DB-vs-API responsibility split: the API rejects ≥ 600000; the DB
    function accepts any non-negative integer).
  - Recompute reorders: import a fixture race where Brandon finished
    just ahead of Willy by ≤ 1s; apply a 5s penalty to Brandon; assert
    Brandon's placement → 2, Willy's placement → 1.
  - Tie-on-adjusted-total: two drivers with identical `total_time_ms`;
    apply a penalty to one such that both adjusted totals still tie;
    assert tiebreak falls to `transponder_id ASC`.
- `rc-tracks.test.ts` (new): `createTrack` happy path; slug-collision
  (two calls with names that slugify identically → second gets a
  numeric suffix); case-insensitive name match short-circuits to the
  existing track ID without creating a new row.
- `rc-permissions.test.ts` (edit): four new cases for `canEditRace`
  (`null`, `'user'`, `'tournament_admin'`, `'global_admin'`).
- `migrate.test.ts` (edit): assert running migrate twice doesn't add
  the column twice (idempotency); on a fresh DB, `PRAGMA
  table_info(rc_race_drivers)` includes `penalty_ms` with default `0`.

### Integration (`tests/integration/`)

- `rc-admin-edits.test.ts` (new):
  - **Penalty round-trip**: import the fixture, apply a 5000ms penalty
    to one driver in the "final" race; call `standingsForRace`; assert
    the new `adjusted_total_time_ms` reflects the penalty and the
    placements are re-derived consistently.
  - **Penalty clears**: apply a penalty, then set it back to 0; assert
    placements restore to the original import order.
  - **Track change end-to-end**: import the fixture into "Track A",
    then call `setRaceTrack` to move one race to "Track B"; assert the
    race appears in `listRaces({ trackId: trackB })` and is no longer
    in `listRaces({ trackId: trackA })`; assert `bestLapsForTrack` for
    track A excludes that race's laps and track B includes them.
- `rc-import.test.ts` (edit): add a single assertion that
  `penalty_ms === 0` for every row immediately after import (regression
  guard for the DEFAULT 0).

### Test count

~10–12 new + 3 small edits to existing tests. The integration tests
that import the full fixture (`Agents/fixtures/lap-monitor-sample.json`)
are the heavy ones; the unit tests use bespoke 2-driver fixtures
inlined in the test file.

---

## Three must-work flows

### Flow 1 — Track reassignment

A `global_admin` opens `/racing/<raceId>` and sees an "Admin" section
between the standings table and the lap-by-lap details (only when
signed in as global_admin; anonymous + regular users don't see it).
The section's top row is a track picker labelled "Track" showing the
currently-assigned track ("Outdoor Long") as the selected `<option>`.
They pick "Outdoor Short" from the dropdown and tap **Save**. The
client PATCHes `/api/racing/races/<raceId>` with `{ trackId: '...' }`,
the server checks the session, runs `setRaceTrack`, returns
`{ status: 'ok' }`. `router.refresh()` re-renders the server
component: the page header's track-name link now reads "Outdoor
Short". The race vanishes from `/racing/tracks/outdoor-long`'s
leaderboard (its laps no longer count for that track) and appears on
`/racing/tracks/outdoor-short`'s best-lap leaderboard at the right
position. The `lap_monitor_uuid` UNIQUE constraint is untouched —
re-uploading the same JSON later still dedupes via `rc_races.lap_monitor_uuid`.

### Flow 2 — Penalty application

Same admin, same page. Below the track picker is a small table: each
driver, their current penalty (in seconds, defaults to "0.0"), and a
Save button. They type `5` next to Brandon (5 seconds), tap **Save**.
The client converts to `penalty_ms: 5000`, PATCHes
`/api/racing/races/<raceId>/drivers/<brandonId>`. The server validates,
runs `setDriverPenalty`, which (in one transaction) writes
`penalty_ms = 5000` and recomputes placements per `comparePlacement`
ordering. If Brandon was 1st by < 5s, Willy becomes 1st and Brandon
becomes 2nd. The standings table above re-renders showing
"+5.0s" in amber in the new Penalty column, "Total" reads
Brandon's `total_time_ms + 5000`, and the row order has swapped.
The lap chart and per-driver pace stats (Best, Avg, Median, etc.) are
**identical** to before — penalty is total-only, no `rc_laps` row
moves.

### Flow 3 — Penalty clears

Operator changes their mind. They type `0` back into Brandon's
penalty field and tap **Save**. The PATCH writes `penalty_ms = 0`,
the recompute fires again, and placements restore to the original
import order. The standings table's Penalty column shows `—` for
Brandon's row. Net effect equivalent to the pre-Flow-2 state.

---

## Track-change semantics (recap)

- **When the operator picks an existing track from the dropdown**:
  body is `{ trackId }`, the server hands it to `setRaceTrack`, one
  UPDATE to `rc_races.track_id`. No track row created.
- **When the operator types a new track name**: body is
  `{ trackName }`, the server runs `createTrack(name)` (extracted to
  `lib/rc/tracks.ts` shared with the import route), then
  `setRaceTrack(raceId, newId)`.
- **What if the typed name matches an existing track name (case-insensitive)?**
  The shared `createTrack` helper does NOT dedupe by name — both R1's
  import and H2's edit allow the operator to create "Outdoor Long" and
  "outdoor long" as separate rows if they really want. The slug
  collision loop only handles slug uniqueness. If the operator wants
  to dedupe, they pick from the dropdown instead of typing. This is
  intentional — name dedupe is a UX feature the operator can ask for
  if it bites, not a correctness invariant.
- **Old track left empty**: not deleted. Cleanup is out of scope (see
  Hand-offs).
- **Re-import after a track change**: the `lap_monitor_uuid` UNIQUE
  constraint catches the race — `findRace.get(race.uuid)` returns the
  existing row regardless of which track it's now on, and the importer
  counts it as `duplicateRaces`. No mutation. (Confirmed in
  `lib/rc/import.ts:89-93,130-135`.)

---

## Standings recompute with penalty (recap)

- `rc_race_drivers.placement` is **stored**, not derived at read time.
- On every `setDriverPenalty`, the recompute step issues N+1 UPDATEs
  inside the same transaction: one for the penalty, then one per
  driver (typically 2–8 in our fixture) to rewrite `placement`.
- Ordering function exactly matches `comparePlacement(a, b)` in
  `lib/rc/import.ts:254` — `laps DESC, adjusted_total_time_ms ASC,
  transponder_id ASC`. Keeping them aligned is a correctness
  invariant; if the importer ever changes the tiebreak, this code path
  must change with it. Documented in a comment next to both
  `comparePlacement` and `setDriverPenalty`.
- Transaction provides "either every placement is consistent with the
  new penalty, or nothing changed".

---

## Effect on lap chart and per-driver stats (recap)

`rc_laps` rows are **not touched** by any H2 mutation. Therefore:

- `LapChart.tsx` (renders `rc_laps`) is unchanged.
- `computeDriverStats` (consumes `rc_laps`) is unchanged.
- `bestLapsForTrack`, `perTrackBestsForDriver`, `recentRacesForDriver`
  — none depend on `total_time_ms + penalty_ms`. `recentRacesForDriver`
  returns `total_time_ms` (raw) today; H2 leaves it that way (the
  driver profile is a per-driver pace surface, not a results-board).
  If R2 wants the adjusted total in the driver profile too, it can
  amend the SELECT then.
- The race-detail page's lap-by-lap section is the same.

Only the standings table (and the leaderboard route's display, since
its row order on `/racing/tracks/<slug>` is driven by best-lap, not
total) changes its presentation.

---

## Out of scope for H2 (do NOT build)

- Editing lap times. Admins arguing about whether a specific lap
  counted is a separate, larger feature.
- Adding or removing drivers from a race.
- Audit log of admin edits. `source_blob` on `rc_races` preserves the
  original JSON; H2 edits are silent for now.
- Bulk penalty application ("add 5s to everyone"). Per-driver only.
- ELO integration of penalty-adjusted standings — R2 territory.
- Tournament_admin RC privileges. Global_admin only for H2.
- Wizard changes. H2 should require zero wizard edits.
- Auto-cleanup of empty `rc_tracks` rows after track change.

---

## Quality bar (same as M1–R1, H1)

- No comments unless WHY is non-obvious.
- No mocks at the DB boundary. Ephemeral SQLite per test file.
- TypeScript strict; no `any` without a `// reason:` line.
- ESLint + Prettier + typecheck + build clean.
- Mobile-first: 44px tap targets on every admin control; the penalty
  input is `type=number` with `inputmode=decimal` for iOS, `step=0.1`
  for one-decimal-place penalties (the common case).

---

## Verification

After implementation lands (commits 3 + 4):

1. `python3 scripts/align.py check` exits 0. No symbol change — H2
   doesn't add new symbols and doesn't change `racing` properties.
2. `cd wizard && python3 -m pytest -q` — still 104 passing. H2 makes
   zero wizard edits.
3. `cd eloup-web && pnpm test && pnpm lint && pnpm typecheck && pnpm build` clean.
4. `docker build -f Dockerfile.eloup-web .` succeeds.
5. Local smoke (operator-driven, after deploy):
   - Sign in as the bootstrap admin.
   - Open `/racing/<raceId>` of a known imported race.
   - Confirm the Admin section renders (only for global_admin).
   - Change the track to a new name → verify the header updates +
     the race shows on the new track's leaderboard.
   - Apply a 5s penalty to the second-place driver in a race where
     the gap to first is < 5s → verify the leader swaps.
   - Reset the penalty to 0 → verify the original leader restores.

Do NOT run the wizard or push to remote. The operator handles deploy
after implementation is reviewed.

---

## Commit shape

Four commits expected (mirroring M2–R1, H1 discipline):

1. `docs: H2 — race admin edits task doc` — this file only. **STOP
   after this commit and request review.**
2. `docs: H2 — reviewer report` — landed by a different agent in
   `Agents/Review-reports/h2-race-admin-edits-review.md` referencing
   this filename.
3. `feat: eloup-web — race admin edits schema + lib + API` — migration
   0005, `setRaceTrack` + `setDriverPenalty` in `lib/db/rc.ts`,
   `canEditRace` in `lib/permissions.ts`, the two new API routes, the
   shared `lib/rc/tracks.ts` extracted from the import route, all
   tests except the UI one.
4. `feat: eloup-web — race admin edits UI` — `RaceAdminPanel.tsx`,
   `app/racing/[raceId]/page.tsx` wiring (session, conditional render,
   standings-table penalty column + footnote), any UI-level test (if
   we end up with one).

Each commit ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Hand-offs

After H2 ships, the following follow-ups are natural but explicitly
deferred:

- **R2 (RC ELO)** consumes `adjusted_total_time_ms` AND the
  post-recompute `placement` when computing per-track / per-driver
  ELO. The contract is: read `standingsForRace`'s returned rows;
  trust `placement`. Penalty-adjusted total is the right primitive
  for R2's "did this driver beat that one" judgement.
- **Driver profile penalty-adjusted total.** `recentRacesForDriver`
  still returns raw `total_time_ms`; the driver profile page
  (`/racing/drivers/[driverId]`) therefore shows the unadjusted total
  for any race that has a non-zero penalty, while the race-detail page
  shows the adjusted total. R2 should amend the SELECT to return
  `(rd.total_time_ms + rd.penalty_ms) AS adjusted_total_time_ms` and
  update the driver profile display so the two surfaces agree.
- **`layout_notes` invalidation on track change.** Today
  `rc_tracks.layout_notes` has no UI and no query path. If a future
  feature ties layout_notes to lap-time validity (e.g., "long layout"
  vs "short layout" leaderboards), the H2 PATCH route may need to
  surface a warning when the operator moves a race to a track of a
  different layout. Documented here so the future consumer doesn't
  miss it.
- **H3 — Audit log.** A small `rc_admin_edits` table capturing
  `(race_id, driver_id?, edit_kind, old_value, new_value, edited_by,
  edited_at)` would let the operator answer "who changed Brandon's
  penalty?" in production. The shape would emit one row from
  `setRaceTrack` and one from `setDriverPenalty`. Deferred — the
  operator can read `source_blob` today.
- **`rc_tracks` orphan cleanup.** Track changes can leave a track row
  with zero races (or with all races moved away from a typo'd track).
  A small `/racing/admin/tracks` cleanup page that lists empty tracks
  with a "Delete" button would be useful. The DB-level concern is the
  FK: `rc_races.track_id REFERENCES rc_tracks(id)` does NOT have ON
  DELETE — so deletion is safe only when the operator confirms there
  are no races left. Out of scope here.

---

## Clarifying questions surfaced while writing this doc

These came up while drafting; flagging them for the reviewer to weigh
in on before implementation:

1. **Penalty input step size.** The spec calls for seconds in the UI.
   I picked `step=0.1` (one decimal) so an operator can enter "5.5s".
   Lap Monitor itself doesn't seem to produce sub-second-precision
   penalties, and 0.1s × 1000 = 100ms is the smallest non-trivial
   `penalty_ms`. Is `step=1` (whole seconds only) preferable for
   operator ergonomics? I lean toward `0.1` because the API still
   accepts arbitrary `penalty_ms` integers (the UI is the only
   floor), but happy to switch.

2. **Track-rename UX.** If the operator picks a track from the
   dropdown that has a typo'd name, H2 only lets them reassign races
   *away* from it — there's no in-place "rename this track" admin
   tool. Adding one is half a page of work (PATCH
   `/api/racing/tracks/[trackId]` writing `name` + recomputing
   `slug`); flagging in case the reviewer wants to bundle it. I left
   it out because (a) the operator can always create a new track with
   the correct name and reassign, and (b) renaming changes the slug,
   which changes URLs, which is its own UX story (redirects? 404s?).

3. **PATCH idempotency on penalty.** Two rapid taps on Save with the
   same value will issue two PATCHes; the second is a no-op at the
   DB level but it still runs the placement recompute again
   (deterministic, same result). Should the route short-circuit when
   the value is unchanged? I left this out — the recompute is
   cheap (2–8 UPDATEs) and the short-circuit adds branching for
   a non-issue.

4. **Track change to a track of a different `layout_notes`.** The
   schema has `rc_tracks.layout_notes` (unused in R1, no UI). H2
   doesn't touch it. If a future feature ties layout_notes to
   lap-time validity ("this lap was on the long layout, can't be
   counted under the short layout's best-lap leaderboard"), H2's
   track-change feature might need invalidation logic. Flagging so
   the reviewer doesn't ask later.
