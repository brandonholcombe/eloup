# Review: h2-race-admin-edits.md

## Reviewer: claude-sonnet-4-6-h2-reviewer
## Date: 2026-05-17
## Verdict: APPROVE-WITH-CHANGES

## Summary

The H2 plan is well-reasoned, tightly scoped, and technically correct on its core claims. The schema delta is minimal and safe, the transactional placement-recompute logic is sound, and the decision to keep penalty as total-time-only (leaving `rc_laps` untouched) is architecturally right. Two issues require resolution before commit 3 begins: the `setDriverPenalty` transaction does not use `.immediate()` where the rest of the codebase does (a write-contention risk on the LKE pod), and the `trackName` path in the API silently allows case-variant duplicates that the operator may not expect and has no recovery path for without a separate admin tool.

---

## Issues found

**1. [MAJOR] `setDriverPenalty` transaction should use `.immediate()`, not `tx()`**

The plan shows `return tx()` (a deferred transaction). Every other write transaction in this codebase that involves multiple sequential UPDATEs uses `.immediate()` — verified in `lib/rc/import.ts:198` (`tx.immediate()`) and per the M4 confirm-match path called out in the task brief. A deferred transaction on SQLite begins in read mode and only upgrades to write mode when the first write statement executes. Under the LKE pod's single-writer SQLite deployment this is not a correctness issue today, but it is an inconsistency with the established codebase convention and introduces latent risk if concurrency ever changes. The fix is one character: change `return tx()` to `return tx.immediate()` in the `setDriverPenalty` implementation. The plan's prose says "in the same transaction" but the code sample uses `tx()`, which contradicts the pattern documented in M4's review.

**2. [MAJOR] `trackName` auto-create path allows silent case-variant duplicate tracks — no name-normalization or lookup-by-name offered**

The plan explicitly decides (Q-H2-3, track-change semantics recap) that `createTrack` does NOT dedupe by name and that "Outdoor Long" and "outdoor long" can coexist as separate rows. This is a documented intentional choice. However, the impact is asymmetric: an operator who mis-types a new track name via the `trackName` path now has two problems — they cannot rename the typo'd track (out of scope for H2 per Q-H2-clarify-2), and the only recovery is to reassign all races away from it via the admin panel (tedious) and then wait for a future orphan-cleanup tool (H3). More concretely: the dropdown shows existing tracks by name; if two tracks share a near-identical name (e.g. "Outdoor Long" vs "Outdoor long"), the operator cannot tell them apart without looking at slugs. The plan should add a **case-insensitive name lookup** step to the `trackName` path: if an existing track matches the typed name case-insensitively, return it instead of creating a new row, and surface the matched track name in the 200 response so the operator knows what happened. This is a small addition to `lib/rc/tracks.ts`'s `createTrack` helper and does not require a schema change. Without it, the "Add new track…" UX is a footgun at a party where operators are typing on phones under time pressure.

**3. [MINOR] `standingsForRace` callers in `page.tsx` will receive rows with `penalty_ms` and `adjusted_total_time_ms` but the existing call-site types them as `RcStandingRow` — TypeScript will break without the type update**

The current `standingsForRace` in `lib/db/rc.ts` returns `RcStandingRow[]`, and `page.tsx` consumes that type directly (line 23: `const standings = standingsForRace(handle, race.id)`). The plan adds `penalty_ms` and `adjusted_total_time_ms` to `RcStandingRow` as part of Phase B. This is correct. However, the task must make clear that the type change lands in commit 3 (schema + lib), and the `page.tsx` usage of `s.adjusted_total_time_ms` in commit 4 (UI) must not be attempted before the type is updated — otherwise commit 4 will fail `pnpm typecheck`. The commit split (3 = lib/API, 4 = UI) handles this correctly only if the full `RcStandingRow` type update and SQL SELECT update land together in commit 3. The plan implies this but does not state it explicitly. Call it out in the task doc as a cross-commit dependency: **`RcStandingRow` type + SQL must be in commit 3, not deferred to commit 4.** This is MINOR because the plan's phasing already puts both in Phase B/commit 3 — it just isn't spelled out as a dependency.

**4. [MINOR] `recentRacesForDriver` returns raw `total_time_ms` — penalty-adjusted totals are silently absent from the driver profile page**

The plan acknowledges this in the "Effect on lap chart and per-driver stats" recap: "`recentRacesForDriver` returns `total_time_ms` (raw) today; H2 leaves it that way." This is an intentional deferral to R2. However, the driver profile page (`/racing/drivers/[driverId]`) currently shows `total_time_ms` in the recent-races list. After H2 ships, an operator who applied a 5s penalty to Brandon in the final race will see two contradictory totals: the race-detail standings show the adjusted total, but the driver profile shows the raw total. This is a UX inconsistency that should be documented in H2's Hand-offs section (currently it is not) so R2 doesn't miss it. Flag it in the Hand-offs as: "driver profile's `recentRacesForDriver` still returns raw `total_time_ms`; R2 should amend the SELECT to return `total_time_ms + penalty_ms AS adjusted_total_time_ms` and update the display." Not blocking H2, but the omission from the Hand-offs is a gap.

**5. [MINOR] Missing test for slug-collision edge case in the `trackName` auto-create path**

The plan's test coverage for Phase E does not include a test for the slug-collision loop in `createTrack`. The R1 importer used the same `slugify + withSuffix` helper, but no test in the existing suite exercises the collision path (two tracks with names that slugify to the same string, e.g., "Outdoor Long!" and "Outdoor Long"). H2 introduces the first operator-facing UI path for creating tracks by name (the import route creates tracks at upload time but the operator doesn't re-hit it interactively). A unit test in `tests/unit/rc-admin-edits.test.ts` or a new `tests/unit/rc-tracks.test.ts` should assert: (a) `createTrack("Outdoor Long")` → slug `outdoor-long`; (b) a second `createTrack("Outdoor Long")` (or anything that produces the same slug) → slug `outdoor-long-2` (or the project's suffix convention). This is achievable with a 2-driver ephemeral DB in < 10 lines.

**6. [MINOR] Cap validation gap: `penalty_ms = 600000` (exactly 10 minutes) should be rejected but the zod schema currently allows it**

The plan states the cap is `< 600000ms` (strictly less than 10 minutes). The zod schema is `z.number().int().min(0).max(599_999)`. This correctly rejects 600000. The DB function `setDriverPenalty` has no upper bound check — it accepts any non-negative integer. The plan explicitly documents this split: "the upper bound is enforced at the API boundary." This is the right design. However, the unit test for `setDriverPenalty` should include a case for `penaltyMs = 600000` that asserts the function returns `{ status: 'ok' }` (it is a valid DB call) to document the API-vs-DB responsibility split clearly and prevent future reviewers from adding a spurious DB-level check. Currently the test plan only lists "rejects negative penalty with `invalid`" for the DB function. Add a `penaltyMs = 600000 → ok` assertion as a companion to make the boundary explicit.

**7. [NIT] Footnote wording "Total includes penalty" is ambiguous when all penalties are zero**

The plan adds a footnote under the standings table: "Total includes penalty." This footnote renders on every race-detail page, including races with no penalties applied. Showing "Total includes penalty" when no driver has a non-zero penalty is misleading — it implies someone was penalized. A conditional footnote — render only when `standings.some(s => s.penalty_ms > 0)` — is one line of JSX and avoids the confusion. This is cosmetic but visible at a party where attendees will read the page.

**8. [NIT] The `setRaceTrack` UPDATE fires even when `trackId === currentTrackId` (no short-circuit)**

The plan notes idempotency correctly ("UPDATE … = same value writes one row of the same content; semantically nothing changes downstream"). This is fine. The Q-H2-3 clarifying question addresses the API-level idempotency; the DB function is intentionally not short-circuiting. No action needed here — just confirming the implementer's position is correct and the NIT is informational only.

---

## Coverage check

- [x] Migration `0005_rc_penalty.sql` — ALTER TABLE with NOT NULL DEFAULT 0 CHECK
- [x] `lib/db/rc.ts` — `penalty_ms` + `adjusted_total_time_ms` added to `RcStandingRow`
- [x] `lib/db/rc.ts` — `standingsForRace` SQL updated to SELECT and ORDER BY adjusted total
- [x] `lib/db/rc.ts` — `setRaceTrack` function with `no_race` / `no_track` return
- [x] `lib/db/rc.ts` — `setDriverPenalty` with transactional placement recompute
- [x] `lib/permissions.ts` — `canEditRace` helper (global_admin only)
- [x] `app/api/racing/races/[raceId]/route.ts` — PATCH for track reassignment
- [x] `app/api/racing/races/[raceId]/drivers/[driverId]/route.ts` — PATCH for penalty
- [x] `lib/rc/tracks.ts` — shared `createTrack` extracted from import route
- [x] `app/racing/[raceId]/page.tsx` — admin section rendered between standings and lap-by-lap
- [x] `components/RaceAdminPanel.tsx` — track picker + penalty table, 44px tap targets
- [x] `tests/unit/rc-admin-edits.test.ts` — `setRaceTrack` and `setDriverPenalty` unit tests
- [x] `tests/unit/rc-permissions.test.ts` — `canEditRace` cases
- [x] `tests/unit/migrate.test.ts` — 0005 idempotency case
- [x] `tests/integration/rc-admin-edits.test.ts` — penalty round-trip, track change end-to-end
- [x] `tests/integration/rc-import.test.ts` — regression assertion `penalty_ms = 0` post-import
- [ ] Slug-collision test for `createTrack` (gap — see finding 5)
- [ ] `penaltyMs = 600000` → `ok` assertion in `setDriverPenalty` unit test (gap — see finding 6)
- [ ] Tie-on-adjusted-total edge case in placement-recompute test (gap — two drivers with identical `total_time_ms + penalty_ms` after penalty applied; tiebreak falls to `transponder_id ASC`)
- [ ] `recentRacesForDriver` raw-vs-adjusted inconsistency documented in Hand-offs (gap — see finding 4)

---

## Strengths worth keeping

- **Penalty is total-time-only, `rc_laps` untouched.** Confirmed against `lib/rc/stats.ts` and `lib/rc/outliers.ts` — neither touches `total_time_ms + penalty_ms`. The plan's correctness claim holds: charts and per-driver pace stats are identical before and after penalty application. This is the right design.
- **Transactional placement recompute with ordering identical to `comparePlacement`.** The SQL ORDER BY in `setDriverPenalty` (`laps_completed DESC, adjusted_total_time_ms ASC, transponder_id ASC`) exactly matches `comparePlacement` in `lib/rc/import.ts:254`. The plan explicitly documents this alignment as a correctness invariant and calls for a comment near both sites. This cross-site coupling is real and the documentation requirement is the right guard against drift.
- **`lap_monitor_uuid` idempotency is unaffected by track reassignment.** Verified against `lib/rc/import.ts:89-93`: `findRace.get(race.uuid)` looks up by UUID, not by `(track_id, race_uuid)`. A re-upload after a track reassignment still hits the UNIQUE constraint and returns `duplicateRaces: 1`. The plan's claim in Q-H2-7 is correct.
- **`createTrack` extracted to `lib/rc/tracks.ts`.** Sharing one helper between the import route and the new PATCH route is the right move. Prevents the slug-collision logic from diverging between two callers.
- **`canEditRace` shape and naming.** The single-function, stateless, `SessionPlayer | null → boolean` pattern matches `canCreateGame` and `canUploadRaceResults` exactly. The `Race` noun is broad enough for future admin expansions (edit laps, remove driver) without requiring a new helper each time.

---

## Positions on the four flagged questions

1. **Penalty input step**: `0.1s`. Rationale: RC officiating commonly applies half-second penalties (e.g. "jump start = +0.5s") and operators at a party may need to enter "5.5" without having to do mental arithmetic. `step=0.1` makes the spinner usable; `step=1` forces operators to manually type fractional values anyway since the API accepts arbitrary integers. The mobile number pad renders the same either way. Keep `step=0.1`.

2. **Track rename**: hold for later. Rationale: renaming changes the slug, which changes URLs, which requires redirect logic or silent 404s for bookmarked links. This is a non-trivial UX story that deserves its own task doc. The operator workaround (create correct-name track, reassign races, ignore empty old track) is adequate for now and is less risky than baking in slug-mutation logic during H2. Noted in finding 2 above that the lack of case-insensitive name lookup (a lesser concern than full rename) is a separate and lower-risk gap worth addressing in H2 itself.

3. **PATCH idempotency short-circuit**: leave alone. Rationale: the recompute is O(N) UPDATEs on a table with 2–8 rows. The round-trip cost is dominated by network latency from the client to the pod, not SQLite write time. A short-circuit adds branching and a read before the write — more code, no measurable gain. The plan's current choice is correct.

4. **`layout_notes` invalidation**: flag for future, not a concern for H2. Rationale: `layout_notes` has no UI and no query path in R1 or H2. The concern the implementer raises (track-change moves a race to a track with different layout semantics, invalidating lap-time comparability) is real but it is a data-integrity problem for a feature that does not yet exist. The correct time to address it is when `layout_notes` gets a consumer — at which point the track-change PATCH can be updated to surface a warning. Document it in the H2 Hand-offs section so R2/H3 authors see it.

---

## Recommended follow-ups for the implementer

1. **[Finding 1 — MAJOR]** Change `return tx()` to `return tx.immediate()` in `setDriverPenalty`. One character. Matches `lib/rc/import.ts:198` and the M4 pattern. Do this in commit 3.

2. **[Finding 2 — MAJOR]** Add a case-insensitive name lookup to the `trackName` path in `lib/rc/tracks.ts`: before calling `slugify + withSuffix`, do a `SELECT id, name FROM rc_tracks WHERE lower(name) = lower(?)` lookup. If a match exists, use that track's ID instead of creating a new row, and return `{ status: 'ok', trackId: existingId, matched: true }` so the PATCH route can include `"matched": true` in its 200 body to signal the operator. This prevents silent case-variant duplicates and keeps the `createTrack` helper consistent with the operator's mental model ("if I type a name that already exists, I get that track"). Update the `trackName` test case in `tests/integration/rc-admin-edits.test.ts` to cover the matched path.

3. **[Finding 4 — MINOR]** Add to the Hand-offs section: "driver profile's `recentRacesForDriver` still returns raw `total_time_ms`; R2 should amend the SELECT to `(rd.total_time_ms + rd.penalty_ms) AS adjusted_total_time_ms` and update the driver profile display to show the penalty-adjusted total."

4. **[Finding 5 — MINOR]** Add a slug-collision unit test to `tests/unit/rc-admin-edits.test.ts` (or a new `tests/unit/rc-tracks.test.ts`): call `createTrack` twice with names that slugify identically; assert the second call produces a slug with a numeric suffix. This pins the collision-loop behavior that both the import route and the new PATCH route share.

5. **[Finding 6 — MINOR]** Add a `setDriverPenalty(db, raceId, driverId, 600000) → { status: 'ok' }` assertion to the unit test to document that the DB function has no upper-bound cap (the cap lives in the API layer). Companion to the existing negative-penalty assertion.

6. **[Finding 3 — MINOR]** Add a note in the task doc's commit-split section: "RcStandingRow type update and standingsForRace SQL SELECT must land in commit 3. The page.tsx reference to `s.adjusted_total_time_ms` in commit 4 will fail typecheck if the type is absent." This protects the implementer from a cross-commit type error if commits 3 and 4 are ever partially re-ordered.

7. **[Finding 7 — NIT]** Render the "Total includes penalty" footnote conditionally: only when `standings.some(s => s.penalty_ms > 0)`. One ternary in JSX.

8. **[Tie-edge-case gap]** Add a unit test: two drivers with the same `total_time_ms`, then apply a penalty to one such that their adjusted totals still tie. Assert tiebreak falls to `transponder_id ASC`, and the lower transponder ID wins. This covers the one placement-recompute edge case not in the plan's test list.
