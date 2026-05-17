# R1 — Reviewer report: RC racing dashboard

## Reviewer: claude-sonnet-4-6-r1-reviewer

This report reviews `r1-rc-racing-dashboard.md`, the implementation plan for the RC-car racing
domain in EloUp. The plan covers Lap Monitor JSON ingestion, a SQLite schema migration, a pure
TypeScript importer, five `/racing/*` routes, a pure-SVG lap chart, and associated tests and
symbol updates.

**Independent Review Rule.** `## Author: claude-opus-4.7-r1-implementer` vs
`## Reviewer: claude-sonnet-4-6-r1-reviewer` — different agents. Prior implementers in this repo
include `claude-opus-4.7-{m2,m3,m4,m5,h1}-implementer`; prior reviewers include
`claude-sonnet-4-6-{m2,m3,m4,m5,h1}-reviewer`. The self-review rule is satisfied.

---

**Verdict: SHIP WITH FIXES.** The plan is structurally sound, derives its decisions correctly from
the fixture, and the schema is close to correct. Two issues must be resolved before commit 3
begins: a self-contradicting outlier-clip percentage and an unspecified validation-granularity
policy that would produce surprising import failures in production. The remaining findings are
minor or cosmetic.

---

## [MAJOR]

### 1. Outlier-clip percentage is self-contradictory

Phase C (`<LapChart>` section) states: "Outliers … clip to the **90th percentile** of Y by
default." Phase F repeats the same component with: "Outlier clipping (**95th percentile** by
default)." These two numbers contradict each other in the same plan document. The implementer
must pick one value and apply it consistently; the test (`rc-format.test.ts` or a dedicated chart
unit test) should pin the chosen threshold. Both are defensible — 95th is more conservative and
better suited to the wide lap-time variance visible in the `final` race fixture (Brandon lap 11:
11,374ms vs. his median ~1,900ms), but the plan must specify a single value. **Pick one and
remove the other before commit 3.**

---

### 2. Zod validation granularity is unspecified — one malformed race silently kills the whole import

The plan says the importer returns `{ status: 'invalid', reason }` for "missing `races` array,
bad `kind`, non-numeric `duration`". The test plan also includes: "Race with no drivers →
`{ status: 'invalid' }`." What is not stated is whether a single malformed race within an
otherwise valid 15-race file makes the entire import fail, or whether the importer skips the bad
race and continues. In a party setting — where the operator uploads a 15-race session and one race
has a transient data anomaly — an all-or-nothing fail is a significant usability cliff.

The two behaviors also require different Zod shapes: whole-file-fatal uses
`z.object({ races: z.array(RaceSchema) })` with strict per-race schemas; skip-bad-races uses a
per-race try-catch or `z.union([RaceSchema, z.unknown()])` with a softer fallback. The
`ImportSummary` type does not include an `invalidRaces` counter, which suggests whole-file-fatal
is intended, but that policy must be explicit in the plan. If whole-file-fatal: add a test
"one race with `kind: 'unknown'` in a 15-race file → the entire import returns
`{ status: 'invalid' }` and no rows are written." If per-race-skip: add `skippedRaces: number`
to `ImportSummary` and a test that confirms the 14 valid races land even when one is malformed.
**Decide and document the policy before commit 3.**

---

## [MINOR]

### 3. Plan's "initial is always 0ms" invariant is imprecise — can mislead the importer

The plan's invariant section states: "initial is always 0ms." Verified against the fixture: the
`duration` field is 0 for every initial lap (correct), but `endTimestamp` is not always 0. In the
`final` race (uuid `E42AD956`), Brandon's initial lap has `endTimestamp: 165` and Willy's has
`endTimestamp: 2`. In the `Semi Final`, Brandon's initial is `endTimestamp: 112`. This is correct
device behavior: the initial lap records when the driver first crossed the timing loop after the
race-start signal. The `duration` is always 0 because the initial crossing is not counted as a
lap; the non-zero `endTimestamp` is the start-crossing offset.

The current schema (`end_timestamp_ms INTEGER NOT NULL`) stores the actual value, so the
schema handles this correctly. The danger is that an implementer reading "initial is always 0ms"
might add an `assert endTimestamp === 0` guard or store `0` hard-coded for initial laps,
silently discarding real data. **Change the invariant to: "initial laps always have
`duration: 0`; their `endTimestamp` encodes when the driver crossed the start line and must be
stored as-is (it is non-zero in race-kind laps in the fixture)."**

---

### 4. `BottomNav.tsx` typed href union requires a TypeScript change the plan does not call out

The `ITEMS` constant in `BottomNav.tsx` has an explicit `href` type union:
```ts
href: '/leaderboards' | '/matches' | '/tournaments' | '/profile'
```
Adding a `Racing` slot requires extending this union to include `'/racing'`. The plan says "add a
Racing slot" but does not mention updating the type annotation. At `pnpm typecheck`, an `href:
'/racing'` literal that does not appear in the union will produce a type error. This is a
five-minute fix but omitting it from the plan means the implementer may run into an unexpected
typecheck failure. **Add a bullet to commit 4's scope: "Extend the `href` union in
`BottomNav.tsx` to include `'/racing'`."**

---

### 5. Nullable `transponder_id` is used as a deterministic tiebreak, producing silent unfairness

The schema declares `transponder_id INTEGER` (nullable) on `rc_race_drivers`. The placement sort
is `(laps_completed DESC, total_time_ms ASC, transponder_id ASC)`. In SQLite, `NULL` is
considered greater than any integer in an ascending sort, so a driver with no transponder always
loses a tiebreak regardless of anything else about their performance. The fixture always provides
`transponderId`, so this is a practical non-issue for R1 — but the comment on the transponder
tiebreak should note this behavior so a future multi-device session (with one driver missing a
transponder registration) doesn't produce silently wrong placements. Alternatively, mark the
column `NOT NULL` since Lap Monitor always provides it. **Either add `NOT NULL` to
`transponder_id` (simplest fix) or add a comment above the tiebreak sort noting that NULL sorts
last in SQLite.**

---

## [NIT]

### 6. `lap_number` column is not explicitly mapped to `userIndex` in the plan

The schema includes `lap_number INTEGER` (nullable) on `rc_laps`, and the mapping table says
"one `rc_laps` row per element (including initial+ignored)." The plan never explicitly states
what `lap_number` stores: is it `userIndex` verbatim (0, 1+, -1)? Or the display-friendly
1-based count for normal laps only (NULL for initial/ignored)? The `userIndex` value of `-1` for
ignored laps makes it awkward for display. A one-line note in §"JSON schema and mapping" would
close this: "Store `lap_number = userIndex` verbatim (including 0 and -1); UI filters by
`lap_kind` for display."

---

### 7. `extraTime` and `minLapTime` are in `source_blob` but `minLapTime` matters for R2

The plan correctly stores the full per-race JSON in `source_blob`. However, `minLapTime` is the
device-level sanity filter that determines which laps become `ignored` vs `normal`. If R2 ever
recomputes placement from `source_blob`, the recomputation must re-apply the same `minLapTime`
threshold to produce identical results. Storing `minLapTime` only inside the opaque `source_blob`
makes it invisible to any SQL query. Consider adding `min_lap_time_ms INTEGER` as a column on
`rc_races` (derivable at import time from `race.minLapTime * 1000`). This is not blocking for
R1 display-only use, but the R2 hand-off section should note that `minLapTime` is buried in
`source_blob` and would need extraction if recompute logic runs in SQL.

---

### 8. `racing` symbol has empty `interlocks: {}` despite touching `auth` and `architecture.db`

The proposed symbol correctly captures `upload_role: "global_admin"` and `anonymous_view: true`,
which are properties that interlock with the `auth` symbol's `roles` list and
`architecture.db = "sqlite"` respectively. The M5 `tournaments` symbol also left interlocks
empty, so this is consistent with project convention, but the `auth` symbol's roles list is the
ground-truth gate for what `canUploadRaceResults` enforces — a future role rename would break the
permission silently. Adding `"auth.roles": "upload_role"` to `interlocks` would make this
machine-verifiable. Not blocking.

---

## What the plan got right

- **Schema idempotency anchor.** Using `lap_monitor_uuid UNIQUE` on `rc_races` rather than the
  brief's `UNIQUE(track_id, race_started_at)` is strictly correct. The fixture confirms that every
  race has a UUID; the stronger anchor means re-upload to a different track is still rejected,
  which is the right behavior.

- **Driver identity model.** Decoupling `rc_drivers` from `players` via
  `lap_monitor_driver_uuid` with an optional `player_id` link is the right call for R1. Lap
  Monitor exports driver UUIDs; forced Discord linkage at upload time would block the demo.

- **Track-at-upload decision.** The JSON genuinely has no track field (confirmed in the fixture).
  The operator-specified-at-upload model is the correct MVP choice. The picker-or-new-name UI
  is the right shape; a separate `/racing/tracks/new` pre-creation form would be unnecessary
  friction for the party-night use case.

- **`rc_laps` uses array-position `lap_index` as PK.** Using `(race_id, driver_id, lap_index)` as
  the PK rather than `userIndex` is correct: `userIndex = -1` repeats for multiple ignored laps
  in the fixture and cannot serve as a unique key.

- **Derived fields are correct.** `laps_completed = count(normal)`, `best_lap_ms = min(duration
  where normal)`, `total_time_ms = endTimestamp of last(normal|ignored)`, and the placement sort
  `(laps_completed DESC, total_time_ms ASC, transponder_id ASC)` are all confirmed against the
  fixture. The test assertions ("Willy wins Q12 on total time with equal lap counts") will pass.

- **SVG chart choice.** Pure SVG with no charting library is correct for the fixture's lap
  counts (10–18 laps, 2 drivers). The mobile-first JS budget argument is sound.

- **Permission shape.** `canUploadRaceResults` mirrors `canCreateGame` exactly. The 401/403
  split and anonymous read default match `Q-APP-4`.

- **Test plan completeness.** Idempotency-across-different-track and malformed-JSON-via-API-route
  are both in the test plan. The display-name-update-on-re-import test is explicit. The fixture
  race count of 15 is correctly reflected in the idempotency assertion.

- **Commit shape.** Four commits, task-doc-only first, reviewer report second, then
  implementation in two logical slices. Matches M2–M5 + H1 pattern exactly.

- **R2 hand-off.** The decision matrix (a/b/c) is actionable. The `player_id` bridge is the
  right linkage point. The deferral rationale is honest and the `source_blob` audit trail gives
  R2 a recompute path.

---

## Required changes before commit 3

1. **Outlier clip percentage** — pick 90th or 95th and make it consistent across Phase C and
   Phase F. Add a test or comment pinning the chosen value.
2. **Validation granularity** — declare whether a single malformed race is fatal to the whole
   file or silently skipped. Update `ImportSummary` if needed. Add a test that proves the
   declared behavior.

## Suggested but not blocking

- Change the "initial is always 0ms" invariant to clarify it applies to `duration` only, not
  `endTimestamp` (MINOR finding 3).
- Explicitly call out the `BottomNav.tsx` `href` union type change in commit 4 scope (MINOR
  finding 4).
- Add `NOT NULL` to `transponder_id` on `rc_race_drivers` since Lap Monitor always provides it,
  or comment the tiebreak sort (MINOR finding 5).
- Add a one-line mapping note for `lap_number = userIndex` verbatim (NIT finding 6).
- Note `minLapTime` in the R2 hand-off as buried-in-source-blob (NIT finding 7).
