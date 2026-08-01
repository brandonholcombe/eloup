# Review — M8b RC truck cup (points series)

## Reviewer: claude-opus-4.8-m8b-reviewer

Reviews `m8b-rc-cup.md` (Author: `claude-opus-4.8-m8b-implementer`), the
points-series championship over imported RC race results. Verified against the
live schema (`lib/db/migrations/0003`–`0009`), `lib/db/rc.ts`,
`lib/rc/placement.ts`, `lib/rc/import.ts`, `lib/permissions.ts`,
`lib/db/migrate.ts`, `tests/unit/migrate.test.ts`, and `docs/racing.md` /
`symbols/manifest.json`.

## Verdict: Approve-with-changes

The architecture is sound and well-grounded in the real schema. The two
highest-risk assumptions — that raw `placement` is a correct, always-populated,
correction-aware points source, and that driver identity is stable across
imports — both **hold**. No blocking issues. Six should-fix items (mostly
correctness-of-detail and doc/test hygiene) and a few optional polish notes.

---

## #1 Placement semantics — VERIFIED (the load-bearing question)

**Is `rc_race_drivers.placement` 1 = winner, ascending, always populated?** Yes.
- Column is `INTEGER NOT NULL` (`0003_rc_racing.sql:41`) — never NULL, no gaps.
- The importer writes placement by sorting with `comparePlacement` and storing
  `i + 1` (`lib/db/rc.ts:252-254`, same loop shape used by the importer). That
  yields a **dense, unique 1..N ranking per race** — exactly one `placement = 1`.
  This is confirmed independently by `listRaces`' winner subquery keying on
  `rd.placement = 1 LIMIT 1` (`lib/db/rc.ts:132-135`).
- Populated for **all three `race_kind`s**: `comparePlacement` branches on kind
  (`race` = laps-then-total-time; `qualif`/`practice` = top-3-avg pace) but
  always produces a total order (`lib/rc/placement.ts:34-69`). `0007` recomputed
  historical practice/qualif rows to the same ranking. So `1-based` holds
  everywhere.

**Does reading raw placement pick up penalty / voided-lap corrections
automatically?** Yes — this is the key finding. `setDriverPenalty` and
`setVoidedLapsCount` both call `recomputePlacements`, which re-sorts and
**writes the corrected placement back into the `placement` column**
(`lib/db/rc.ts:209-315`). There is no separate "adjusted placement" — the raw
column *is* the corrected value. A cup that reads `rc_race_drivers.placement`
therefore inherits every admin correction for free, with zero extra logic. Good.

**Race_kind where placement is meaningless?** `practice` placement is real but
semantically "fastest practice pace," not a race finish — awarding championship
points for it is unusual. The spec's admin-picks-races model correctly makes
this the operator's call (no implicit filter), so this is handled by design, not
a bug. See Should-fix S4 for a small guard-rail suggestion.

**Verdict on #1: correct as specified.** Reading raw `placement` grouped by
`driver_id` is the right source and needs no correction layer.

---

## #5 (part) Driver identity stability across imports — VERIFIED

`rc_drivers.lap_monitor_driver_uuid` is `NOT NULL UNIQUE` (`0003:15`), and the
importer resolves a driver by that UUID first (`findDriver`, `import.ts:98-100`)
and **reuses the existing `rc_drivers.id`** on a hit — only inserting a new row
on a miss. So the same physical driver keeps one stable `driver_id` across every
JSON import, and a cup keyed on `driver_id` aggregates them correctly. Confirmed.

**Caveat (Should-fix S5):** identity is stable only *within* the real-UUID JSON
path. Two fragmentation vectors exist and the cup silently inherits both:
1. TXT imports mint synthetic `txt-name:<name>` UUIDs matched by
   case-insensitive `display_name` (`import.ts:107-112`). A human who appears in
   both a TXT import and a real-UUID JSON — or under two different Lap Monitor
   UUIDs (re-registered transponder/app reinstall) — becomes **two
   `rc_drivers` rows** and thus two standings lines.
2. There is no driver↔driver merge (and driver↔player merge is an explicit
   non-goal). So the cup cannot reunite a split human.

Not blocking for MVP, but the standings can double-count one person. Call it out
in `docs/racing.md` and ideally surface a hint in the admin race-assignment UI.

---

## Findings

### Should-fix

**S1 — `cupStandings` name collides with two different signatures.** The spec
uses `cupStandings(rows, scheme)` as the *pure scorer* (algorithm section, line
63) **and** `cupStandings(db, cupId)` as the *DB-facing lib fn* (lib section,
line 68). These cannot both be named `cupStandings`. Mirror the bracket engine's
split: keep a pure `scoreCup(rows, scheme)` (unit-tested, DB-free) and a thin
`cupStandings(db, cupId)` that does the join then delegates. Fix the spec so the
implementer doesn't ship an ambiguous export.

**S2 — Final tiebreak is non-deterministic on duplicate display names.** The
tiebreak chain ends at `name` (line 60). `rc_drivers.display_name` is **not
unique** and is even mutated across imports (`updateDriverName`,
`import.ts:116-117`). Two drivers with equal points/wins/best-finish *and* equal
names would sort nondeterministically. Append `driver_id ASC` as the terminal
tiebreak for a stable order (the placement recompute already uses an ID/
transponder terminal tiebreak for exactly this reason).

**S3 — Validate `points_scheme` in app code.** SQLite stores it as opaque TEXT;
nothing stops a malformed or negative-valued array from landing. `createCup` /
`updatePointsScheme` must parse-and-validate (non-empty array of non-negative
integers) before write, returning a typed status like the other RC mutators
(`setDriverPenalty` returns `'invalid'`). Otherwise a bad scheme corrupts every
standing silently.

**S4 — Guard against practice-kind races in a cup (soft).** Since raw placement
for `practice` is pace-ranking, not finishing order, at minimum the
add-races admin UI should show each race's `race_kind` so the operator doesn't
unknowingly award points for practice. Optional stronger form: default the
race-picker filter to `race_kind = 'race'` (still overridable). Data model needs
no change — `rc_races.race_kind` is already available.

**S5 — Document driver-identity fragmentation.** Per the verified caveat above,
note in `docs/racing.md` that cup standings key on `driver_id` and a human split
across multiple driver rows (TXT-vs-JSON, or dual UUIDs) will appear as multiple
entrants; there is no merge in v1.

**S6 — Umbrella-plan divergence must be recorded.** The author correctly
deviates from the umbrella's `tournaments.format='points_series'` to an RC-native
model (see #3 below — I endorse it). But leave a breadcrumb: update
`m8-tournament-formats.md` (or the umbrella review) so later 8x sub-parts don't
assume a `tournaments` row exists for the cup. Otherwise the umbrella and 8b
drift.

### Optional

**O1 — Add an index on `rc_cup_races(race_id)`.** The spec indexes only
`(cup_id)`. Deleting a race cascades to `rc_cup_races` via the `race_id` FK, and
"which cups contain race X" is a natural reverse lookup; the PK `(cup_id,
race_id)` doesn't cover a `race_id`-leading probe. `idx_rc_cup_races_race`
is cheap. (CASCADE itself is fine — `foreign_keys = ON` is set in
`lib/db/client.ts:11,22`, so the `ON DELETE CASCADE` on both FKs works in prod.)

**O2 — Standings rank/medal on tied points.** Decide the display rule when two
drivers are fully tied through every tiebreak (shared rank vs. arbitrary split).
`rankMedal` reuse is fine; just specify the intended behavior for the unit test.

**O3 — 0-race / empty-cup paths.** A driver in zero of the cup's races simply
won't appear (rows come only from `rc_cup_races → rc_race_drivers`), and an empty
cup yields empty standings — both correct, worth an explicit unit assertion.

---

## Judgments on the review-ask questions

**#2 Scoring correctness — sound.** `points = Σ scheme[placement-1]` with
0-beyond-cutoff is correct given dense 1-based placement. `wins = count(placement
= 1)` is unambiguous because placement is unique per race (verified #1).
Extracting a pure scorer is the right call (matches the bracket engine). Fix the
name collision (S1) and terminal tiebreak (S2); the PK `(race_id, driver_id)`
already prevents a driver appearing twice in one race, as the author notes.

**#3 RC-native vs. tournaments table — endorse the deviation.** The
`tournaments` table is player/ELO-centric; RC is driver-based, `player_id`
nullable, and display-only with no `matches` rows (umbrella B1). Forcing a cup
into `tournaments` is precisely the impedance mismatch the umbrella review
flagged. RC already lives as a self-contained universe (own tables, own
`/racing` routes, own `lib/db/rc.ts`), so a `rc_cups` table under `/racing` does
**not** fragment tournaments — it keeps the two universes cleanly separated. Good
architectural call; just record it (S6).

**#4 Data model — sufficient.** `rc_cups` + `rc_cup_races` cover the MVP.
`points_scheme` as JSON TEXT is reasonable and consistent with the existing
`rc_races.source_blob` JSON-in-TEXT precedent — a structured `rc_cup_points`
table is overkill for a party tool; just validate on write (S3). Slug `UNIQUE`
is correct; reuse `slugify` + `withSuffix` from `lib/slug.ts` (as
`lib/rc/tracks.ts:3,23-30` does) for collision handling in `createCup`.
`created_by REFERENCES players(id)` is correct — `session.user.id` is a player
id and `canUploadRaceResults` requires `global_admin`. CASCADE on both
`rc_cup_races` FKs is correct.

**#5 Scope/UI/perms — appropriate.** `canUploadRaceResults` (global_admin only,
`lib/permissions.ts:19-21`) is the right gate and matches `canEditRace`.
Admin-assigns-races (vs. auto-by-track/kind) is the correct model for a party.
Driver identity is stable (verified above) modulo the TXT/dual-UUID caveat (S5).

**#6 Migrations/symbols — mostly right, one required test edit.** Next number
`0010` is correct (0009 = bracket is the latest). `migrate.ts` auto-loads
migrations by filename, so **no migrate.ts code change is needed** — dropping the
file is enough. But `tests/unit/migrate.test.ts` **hardcodes** the version list
`[1..9]` (line 51) and a table `arrayContaining` (lines 26-46); both must gain
`10` and `rc_cups` / `rc_cup_races`, else the suite fails. Adding a small "0010
creates rc_cups/rc_cup_races" assertion test (mirroring the 0005/0006 pattern) is
nice-to-have. `docs/racing.md` + the `racing` symbol update + `align.py lock` is
the correct path (symbol at `symbols/manifest.json:116-118` points its `docs` at
`docs/racing.md`); refresh the symbol `description` to mention the cup/points
series so alignment stays honest.

---

## Summary of required changes before "Complete"

1. Rename the pure scorer (S1) — no dual-signature `cupStandings`.
2. Add `driver_id` as the terminal standings tiebreak (S2).
3. Validate `points_scheme` on write, typed status (S3).
4. Surface `race_kind` in the add-races UI / default to `race` (S4).
5. Update `tests/unit/migrate.test.ts` version + table lists for 0010 (#6).
6. Doc updates: `docs/racing.md` (cup + identity caveat S5), racing symbol +
   `align.py lock`, and an umbrella breadcrumb for the RC-native deviation (S6).

Optional: `idx_rc_cup_races_race` (O1), tie-display rule (O2), empty-cup tests
(O3).
