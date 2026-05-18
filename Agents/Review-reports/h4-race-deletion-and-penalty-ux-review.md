# Review: h4-race-deletion-and-penalty-ux.md

## Reviewer: claude-sonnet-4-6-h4-reviewer
## Date: 2026-05-17
## Verdict: APPROVE-WITH-CHANGES

## Summary

The H4 plan is clean, tightly scoped, and technically sound on its core claims. The cascade FKs are confirmed in place, the `deleteRace` function shape is correct, and the penalty hint's before/after bracketing approach correctly reads pre-recompute state since `setDriverPenalty` fires the recompute internally. Two issues require resolution before commit 4 begins: the `placement` field drop in the PATCH response is stated ambiguously — the plan says "dropped in favour of the more descriptive pair" but does not confirm whether any existing caller other than tests accesses it, and the component's `onClick` handler lacks a loading/disabled guard that could allow a double-tap delete on a phone. The remaining findings are minor or cosmetic.

---

## Issues found

**1. [MAJOR] `placement` response field is dropped with no backward-compatibility rationale — plan must explicitly commit to additive vs. replacement**

The plan states: "`placement` (the H2 single-field response) is dropped in favour of the more descriptive pair." However, the current `RaceAdminPanel.tsx` `PenaltyRow` component does NOT read `placement` from the PATCH response body at all — it calls `router.refresh()` and the standings table re-renders from the server. No existing test asserts on `placement` in the HTTP response body (the integration test calls `setDriverPenalty` directly and reads from `standingsForRace`, not from the API JSON). So dropping `placement` does not break any current caller.

That said, the plan should state this conclusion explicitly: "No existing caller reads `placement` from the PATCH response body; dropping it is non-breaking." Without that sentence, a future agent reading the plan will be unsure whether there's a hidden caller. Dropping is fine — just document it clearly. This is a documentation gap, not a code gap, but it affects the reviewer's confidence and must be resolved before implementation (commit 3 in the doc's commit shape, or absorbed in commit 4).

**2. [MAJOR] Delete button has no in-flight guard — double-tap on mobile could fire two DELETE requests**

The plan's `DangerZone` UI description shows a Delete button with `onClick: DELETE /api/racing/races/<raceId>`. It does not mention disabling the button while the request is in flight. The existing `TrackChangeForm` and `PenaltyRow` both use `useTransition` + `disabled={pending}` to block double-submission. The Delete action is irreversible — a second concurrent DELETE on the same ID returns 404 (since the first one removes the row), so it won't corrupt data, but the operator may see a confusing error flash ("race not found") after a successful delete. More importantly, if the button is not disabled during the request, rapid taps could push two navigations. The plan must specify `disabled={pending}` on the Delete button and use `useTransition` (or equivalent) for the async DELETE call, consistent with the rest of the panel. This is the same pattern already established in `PenaltyRow` — the plan simply omits it.

**3. [MINOR] The typed-slug match drops `penalty_ms > 0` guard but the Delete path has an equivalent gap: the confirmation input is not cleared on error**

When the DELETE request returns a non-204 (e.g. 403 stale session, 404 already deleted), the plan renders an inline error message. It does not mention resetting the confirmation input value. If the admin's session expires mid-flow, they type the confirmation string, click Delete, get a 401 error, log back in, and now the confirmation input already contains the slug — the Delete button is immediately enabled again. This is a minor UX rough edge (session expiry is rare), but the plan should note that on any non-204 response the confirmation input is reset to `''` (or left as-is intentionally). For the error-after-delete case (race already gone, returns 404), resetting the input prevents re-clicking Delete without re-typing.

**4. [MINOR] `router.push('/racing')` after delete navigates away before the router cache invalidates the race list**

The plan calls `router.push('/racing')` on 204. Next.js App Router's client cache for `/racing` may serve the stale race list (with the deleted race still present) for a few seconds if the cache TTL hasn't expired. This is a known App Router behavior with `dynamic = 'force-dynamic'`: the server page always re-fetches, but the client router cache may not. The fix is `router.push('/racing')` followed by `router.refresh()` (same pattern the PATCH handlers use after a successful save). The plan should explicitly include the `router.refresh()` call after the push, or justify why it's not needed here.

**5. [MINOR] `placement_before` can be `null` for a race with no existing standings — hint condition guard is correct but null handling is implicit**

The plan's hint condition is:
```ts
typeof data.placement_before === 'number' &&
typeof data.placement_after === 'number' &&
```
This correctly guards against `null` (since `typeof null !== 'number'`). However, the API route returns `placement_before = beforeRow?.placement ?? null` — if `standingsForRace` returns no row for the driver (which should not happen in production but could in a test fixture edge case), both values are `null` and the hint does not appear. This is the correct behavior but the plan should note the guard is intentional, not accidental.

**6. [MINOR] Test 7 (cross-race isolation) needs an explicit BEFORE row count assertion, not just an AFTER check**

The plan's test 7 states: "import the fixture (which yields multiple races); DELETE one race; assert another race's row counts in `rc_race_drivers` and `rc_laps` are UNCHANGED." An "UNCHANGED" assertion requires knowing the before count. The plan's prose implies the implementer will capture the count before delete, but it doesn't explicitly call this out. The test should follow the same pattern as test 6: `SELECT COUNT(*) ... = N_before` both before and after the delete. Without the before count, the test could pass vacuously if the fixture has zero rows for the second race.

**7. [NIT] Danger zone `<hr>` separator is mentioned in prose but not in the component spec**

The plan says the Danger zone is "separated from the track + penalty controls by a horizontal rule." The component sketch doesn't include the `<hr>` tag explicitly. This is cosmetic, but the H2 review found a similar omission (footnote rendering condition) that was worth calling out. Include the `<hr>` (or `border-t border-red-900/30`) in the component spec so the implementer doesn't have to invent it.

**8. [NIT] `text-[10px]` on the penalty hint is used for an actionable piece of information, not just decorative footnote text**

The plan uses `text-[10px]` to match "existing footnote styling elsewhere." The footnotes elsewhere (`"Laps over 3× a driver's fastest are hidden..."`, `"Total includes penalty."`) are supplementary. The hint `"Position unchanged — driver completed more laps"` is communicating the result of an action. At `text-[10px]` this may be hard to read on a small phone screen. The H2 penalty error uses `text-xs` (12px). Consider `text-xs` to match the error pattern, or add an explicit `aria-live="polite"` region so screen readers announce it. The plan's `text-amber-400` colour is fine.

---

## Coverage check

- [x] `lib/db/rc.ts` — `deleteRace(db, raceId)` function specified
- [x] `app/api/racing/races/[raceId]/route.ts` — DELETE handler, 401/403/404/204 shape
- [x] `app/api/racing/races/[raceId]/drivers/[driverId]/route.ts` — PATCH extended with `placement_before`/`placement_after`/`penalty_ms`
- [x] `components/RaceAdminPanel.tsx` — Danger zone section + per-driver hint slot
- [x] Cascade-delete verified: `rc_race_drivers.race_id ON DELETE CASCADE` confirmed at line 38, `rc_laps.race_id ON DELETE CASCADE` confirmed at line 51 of `0003_rc_racing.sql`
- [x] Auth gate reuses `canEditRace` — confirmed in `lib/permissions.ts` (global_admin only)
- [x] `app/racing/[raceId]/page.tsx` — `notFound()` already wired at line 24 (`if (!race) notFound()`)
- [x] `setDriverPenalty` contract unchanged — confirmed in `lib/db/rc.ts`, recompute fires inside the transaction
- [x] `placement_before` captured BEFORE `setDriverPenalty` call — plan correctly brackets the mutation
- [x] `standingsForRace` is correct for pre/post reads — confirmed: it returns current DB state, so pre-call read gives old placement, post-call read gives new
- [x] Test 1: deleteRace happy path with row-count assertions
- [x] Test 2: deleteRace no_row case
- [x] Tests 3-5: DELETE 401/403/404 integration paths
- [x] Test 6: DELETE 204 with cascade row-count assertions for both rc_race_drivers AND rc_laps
- [x] Test 7: Cross-race isolation (delete race A, race B rows unchanged)
- [x] Test 8: PATCH response includes placement_before + placement_after
- [x] Test 9: Laps-locked case (placement_before === placement_after after penalty)
- [x] Test 10: Tiebreak-flip case (placement_before !== placement_after after penalty)
- [ ] `placement` field drop documented as non-breaking (gap — see finding 1)
- [ ] Delete button in-flight guard specified (gap — see finding 2)
- [ ] Post-delete `router.refresh()` call alongside `router.push` (gap — see finding 4)
- [ ] Test 7 explicit BEFORE row count captured (gap — see finding 6)
- [ ] Confirmation input reset on error specified (gap — see finding 3)

---

## Strengths worth keeping

- **Cascade FK verification is cited precisely.** The plan names `0003_rc_racing.sql:38,52` — both confirmed: line 38 is `rc_race_drivers` CASCADE, line 51 is `rc_laps` CASCADE. No orphan rows can survive; the plan's claim is correct.

- **`placement_before` bracketing logic is correct.** Reading standings BEFORE calling `setDriverPenalty` and AFTER gives correct before/after values because the recompute fires inside `setDriverPenalty`'s transaction. The plan correctly identifies this and keeps `setDriverPenalty`'s signature unchanged.

- **Hint clear-on-input-change is the right default.** Clearing `hint` in `onChange` prevents stale hints after the operator types a new value. The "re-show on re-save" behavior (Q4) is also correct — each save communicates its own result independently.

- **`deleteRace` wrapped in `.immediate()` transaction.** Matches the H2 convention established for all write transactions (`setRaceTrack`, `setDriverPenalty`). The plan adopted this without prompting — good discipline.

- **Typed-slug case-insensitive match is the right call for mobile.** Phone keyboards auto-capitalize and operator race names are short. The case-insensitive comparison prevents frustrating mismatches that browser `confirm()` would never have surfaced.

---

## Positions on the 5 flagged clarifying questions

1. **Race-name case sensitivity (Q1):** Case-insensitive trim match is correct. Phone auto-capitalization is unpredictable, and race names like "R2" or "Final" are trivially short — the deliberateness of having to type the name is the intent, not case precision. Confirmed: keep case-insensitive.

2. **Long race name confirmation (Q2):** No length cap needed on the confirmation prompt. The schema's `race_name TEXT` has no cap, but the operator controls all race names; a 200-char name is an operator-caused problem. Truncating the expected match string (e.g. to 40 chars) would let an operator confirm ANY race whose name starts with the same 40 chars — worse than no cap at all. Leave as-is: type the full name. If names turn out to be long in practice, the operator can request a name cap via a schema migration.

3. **DELETE response: 204 vs 200 (Q3):** 204 with no body. HTTP semantics are clear: 204 means "succeeded, nothing to return." The client already knows the `raceId` it sent; echoing `{status: 'ok'}` adds no information. Consistency with the existing PATCH (200 with body) is less important than correctness. Keep 204.

4. **Hint re-show on repeated save (Q4):** Allow re-show on re-save. Each save communicates its own outcome. The "don't re-show the same hint twice in a row" debounce would require tracking `lastHint` and comparing — more code, marginal benefit. The operator will see the hint briefly disappear (cleared on the prior save's `router.refresh()`) and re-appear on the new save, which is actually helpful feedback. Keep the current behavior.

5. **Stale page for second admin (Q5):** Acceptable for the current single-admin use case. The stale admin's next interaction (save penalty, change track) will get a 404, which is clear enough. A "this race may have been deleted" banner would add complexity for a near-zero-frequency case. Flag it in the Hand-offs for when multi-admin is added, as the plan already does. Confirmed: no action needed in H4.

---

## Recommended follow-ups for the implementer

1. **[Finding 1 — MAJOR]** Add one sentence to the Phase B API route notes: "No existing caller reads `placement` from the PATCH response body (the component calls `router.refresh()` only; existing tests call `standingsForRace` directly). Dropping `placement` is non-breaking." This documents the decision as intentional and confirmed, not an oversight.

2. **[Finding 2 — MAJOR]** Add `useTransition` + `disabled={pending}` to the `DangerZone` Delete button. The pattern is already in `TrackChangeForm` and `PenaltyRow` — mirror it exactly. Add to the component spec: "On click: `start(async () => { ... })`. Delete button is `disabled={pending}` during the request."

3. **[Finding 4 — MINOR]** Add `router.refresh()` after `router.push('/racing')` on 204 to bust the Next.js App Router client cache. Pattern: `router.push('/racing'); router.refresh();`. Without this the race list may briefly show the deleted race.

4. **[Finding 6 — MINOR]** In test 7, explicitly capture the row count for `race_b` BEFORE deleting `race_a`, then assert it equals the row count AFTER. Example: `const before = db.prepare('SELECT COUNT(*) AS n FROM rc_race_drivers WHERE race_id = ?').get(raceBId).n; deleteRace(db, raceAId); expect(db.prepare(...).get(raceBId).n).toBe(before);` This makes the isolation test non-vacuous.

5. **[Finding 3 — MINOR]** Specify in the component spec that the confirmation input is reset to `''` on any non-204 response (error path). This prevents the Delete button remaining enabled after an error, which would allow a click-without-retype on next attempt.

6. **[Finding 8 — NIT]** Bump the penalty hint from `text-[10px]` to `text-xs` to match the existing error message styling in `PenaltyRow` (`text-xs text-red-400`). Actionable feedback should be at least as legible as error text.
