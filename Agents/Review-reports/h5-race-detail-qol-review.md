# Review: h5-race-detail-qol.md

## Reviewer: claude-sonnet-4-6-h5-reviewer
## Date: 2026-05-17
## Verdict: APPROVE-WITH-CHANGES

## Summary

The H5 plan is well-structured and technically grounded across all four phases. The schema claim is verified correct (`rc_drivers.player_id` is nullable FK at line 18 of `0003_rc_racing.sql`), the DB function shapes fit cleanly into `lib/db/rc.ts`'s existing `.immediate()` transaction pattern, and the `LapChart` chip-to-button conversion is mechanically feasible given the current `<li>` structure. Two issues require resolution before commit 4: the long-press implementation is missing explicit iOS Safari context-menu suppression, which will cause the system popover to fight the isolate gesture on iPhones; and the `useEffect`-based URL sync in `CompareDriversSection` has a subtle but real bug where the effect fires once on mount even when `selected` is empty, potentially clobbering the existing URL with a no-op replace. The remaining findings are minor or cosmetic.

---

## Issues found

**1. [MAJOR] Long-press on iOS Safari triggers the system context menu without explicit suppression**

The plan's `DriverChip` uses `onPointerDown` + 500ms `setTimeout` for isolate. On iOS Safari, a 500ms hold on any interactive element fires the system context menu (share sheet / copy-link popover) at the same time the isolate fires. The plan notes "iOS Safari sometimes fires `onPointerCancel` instead of `onPointerUp` on scroll" — which is true — but does not address the context menu collision.

The fix is two lines, one or both of which must be present:

```tsx
// Option A — suppress context menu directly
onContextMenu={(e) => e.preventDefault()}

// Option B — CSS touch-action to prevent the browser's long-press behaviour
style={{ touchAction: 'none' }}   // or: className="touch-none" (Tailwind)
```

`touchAction: 'none'` is the more complete fix: it also prevents the OS-level "text selection" that Safari triggers on long holds. Without it, a 500ms long-press on a chip in a real iPhone browser will reliably open the Safari context menu instead of isolating the driver. The plan's Q-H5-5 rationale ("500ms is muscle-memory-compatible with iOS Safari's own long-press threshold") makes this worse, not better — the implementer chose exactly the threshold that collides with the system gesture.

**Required fix:** Add `onContextMenu={(e) => e.preventDefault()}` and `className="... touch-none"` (or `style={{ touchAction: 'none' }}`) to the `<button>` in `DriverChip`. Document the reason with a comment (the `onContextMenu` suppression is non-obvious and will be deleted by a future maintainer without one).

---

**2. [MAJOR] `CompareDriversSection` `useEffect` fires on every mount including the empty-selection case, potentially issuing a spurious `router.replace`**

The plan's URL sync effect is:

```tsx
useEffect(() => {
  const qs = selected.length > 0 ? `?compare=${selected.join(',')}` : window.location.pathname;
  router.replace(qs, { scroll: false });
}, [selected, router]);
```

When the user arrives at the page without a `?compare=` param, `initial` is `[]`, `selected` starts as `[]`, and the effect fires on mount with `selected.length === 0`. The branch `window.location.pathname` returns the pathname only (e.g. `/racing/abc123`) and calls `router.replace('/racing/abc123', { scroll: false })`. This strips any other query parameters that may be present in the URL (e.g. a UTM tag, or a future `?tab=` param), and it fires an unnecessary navigation on every cold page load.

Additionally, `router` is listed as a dependency. In Next.js App Router, `useRouter()` returns a stable reference per render, but the linter will flag it if omitted and including it does no real harm — this is not a bug, just worth noting.

**Required fix:** Guard the effect so it does not fire on initial mount with an empty selection, and so it does not fire when the current URL already matches the desired state. The cleanest approach is a `useRef(false)` "mounted" guard:

```tsx
const mounted = useRef(false);
useEffect(() => {
  if (!mounted.current) { mounted.current = true; return; }
  const qs = selected.length > 0 ? `?compare=${selected.join(',')}` : '';
  const current = new URLSearchParams(window.location.search).get('compare') ?? '';
  if (qs !== (current ? `?compare=${current}` : '')) {
    router.replace(qs || window.location.pathname, { scroll: false });
  }
}, [selected, router]);
```

Or simpler: skip the replace entirely when `selected.length === 0` and the current URL has no `?compare=` param already. The core rule is: don't `replace` on mount if nothing has changed.

---

**3. [MINOR] `lapChartClipMaxY` is recomputed from visible drivers only — but this silently changes Y-axis scale on hide/show**

The plan says: "Y-axis tick computation: include only laps from visible drivers (so isolating one driver re-scales the Y-axis to that driver's range)." This is stated as intentional. However, it has a subtle consequence: when you toggle driver B back into view after isolating driver A, the chart rescales again — potentially causing a jarring layout shift where lap times that looked fast at the isolated scale appear in a different position at the full scale. The plan treats re-scale-on-change as a feature ("re-scales the Y-axis to that driver's range") but this is only explicitly described for the isolate action; the toggle-back rescale is not mentioned.

More importantly, `lapChartClipMaxY` takes a `values: number[]` array. Today it is called with `allTimes` (all drivers' laps). The plan proposes filtering `allTimes` to only visible drivers' laps before calling `lapChartClipMaxY`. The existing `lapChartClipMaxY` function is exported and pinned by `tests/unit/lap-chart-clip.test.ts` — the implementer must not change its signature or semantics. The filtering must happen at the call site, not inside `lapChartClipMaxY`.

This is not a blocking issue if the implementer intends rescaling (the plan does say so), but the task doc should acknowledge the toggle-back rescale explicitly so the operator is not surprised. Flag in the implementation comments: "Y-axis rescales whenever the visible set changes, including on toggle-back."

---

**4. [MINOR] `DriverPlayerLink` calls `/api/players/search` but the plan's file table only lists `/api/racing/drivers/[driverId]/route.ts` as the new API route**

The "Files I'll change" table at the top of `h5-race-detail-qol.md` lists:

```
app/api/racing/drivers/[driverId]/route.ts  | new | PATCH handler
```

The `GET /api/players/search/route.ts` addition is described in the Phase C prose and appended in a second "Updated files-I'll-change" mini-table, but it is not in the canonical file table at the top. This creates ambiguity: a downstream agent reading only the file table would miss the new route. The plan should have one consolidated file table. This is a documentation gap, not a code gap.

---

**5. [MINOR] `searchPlayers` LIKE injection risk is overstated but the `%` in `like` variable needs escaping for literal `%` and `_` in search queries**

The plan says "No SQL injection risk: parameter binding." This is correct for SQL injection. However, the `like` variable is constructed as:

```ts
const like = `%${trimmed.toLowerCase()}%`;
```

LIKE patterns treat `%` and `_` as wildcards. If `trimmed` itself contains a `%` or `_` (e.g. a Discord handle like `user_name`), the LIKE pattern `%user_name%` will match any handle containing *any* character where `_` appears. The practical impact is minor (slightly broader matches than intended, not a security hole), but it's a correctness issue: searching for `user_name` should match the literal handle `user_name`, not any handle with *something* in that position.

**Fix:** Escape `%` and `_` in the `trimmed` string before constructing the LIKE pattern:

```ts
const escaped = trimmed.replace(/[%_]/g, '\\$&');
const like = `%${escaped.toLowerCase()}%`;
```

And add `ESCAPE '\\'` to the SQL LIKE clause. This is a one-liner fix and worth doing for correctness, especially since Discord handles can legitimately contain underscores.

---

**6. [MINOR] `CompareDriversSection` test plan relies on "small headless harness" with no spec of what that harness is**

The test plan for `compare-drivers-section.test.ts` says: "Drive state via a small headless harness: instantiate with `drivers=[A, B, C, D]`, simulate `toggle(id)` through the public callback exposed for tests." But `CompareDriversSection` does not currently expose a `toggle` callback — it is internal state. The plan's proposed seam is `initialSelected?: string[]` for test injection, marked `@internal`. This is fine but the test plan should specify explicitly that the seam is the prop, not a simulated click, so the implementer doesn't end up with a `data-testid`-based workaround instead.

Also: the URL-persistence test says "mock via a context-prop seam" if `useRouter` is hard to mock. The `useRouter` + `useSearchParams` dependency means these tests will need either Next.js router mocking or the `initialSelected` seam to work in vitest's jsdom. Given the repo does not have React Testing Library wired, the seam approach is correct but should be called out as the definitive strategy, not "if hard to mock."

---

**7. [MINOR] Phase A `lg:` grid on race detail — CompareDriversSection and admin panel are placed below the grid at full container width, but the page's `max-w-4xl` still applies**

The plan says: "The admin panel + lap-by-lap details + compare section sit below the grid in a full-width block (the compare table needs the full container width when 3 drivers are picked)." The word "full-width" is misleading here: "full-width" means the full 896px of the `max-w-4xl` container, not full viewport width. This is fine — 896px is plenty for a 3-column compare table — but the prose should say "full container width" rather than "full-width" to avoid the implementer wrapping those sections in an outer `w-screen` or `max-w-none` breakout.

---

**8. [NIT] `DriverPlayerLink` renders search results only when `currentLink` is null — but after a successful link, `router.refresh()` re-renders the page with `currentLink` set, which is correct**

The component guards `{currentLink ? <Unlink UI> : <Search UI>}`. After a successful `submit(playerId)`, `router.refresh()` re-SSRs the page with `currentLink` set from `getDriverWithLinkedPlayer`, which correctly switches the component to the Unlink view. This is the right pattern — no finding, just worth confirming explicitly in the implementation comment so a future maintainer doesn't wonder "why does the search input disappear after linking."

---

**9. [NIT] `setDriverPlayer` uses `.immediate()` but the transaction body returns early before the `UPDATE` in two branches**

The `no_driver` and `no_player` branches return inside the `tx` lambda before any writes occur. This is fine in SQLite's WAL mode — `tx.immediate()` acquires a write lock even for read-only transactions, which is a minor performance overhead compared to `tx.deferred()`, but the plan explicitly justifies matching the existing `setRaceTrack` / `setDriverPenalty` / `deleteRace` pattern. Confirmed: `.immediate()` is correct by convention even when the transaction may exit cleanly without writing. No change needed; just confirming consistency.

---

## Coverage check

- [x] Schema claim verified: `rc_drivers.player_id TEXT REFERENCES players(id)` is nullable (no `NOT NULL`) at line 18 of `0003_rc_racing.sql`
- [x] `setDriverPlayer` shape fits existing `.immediate()` transaction pattern in `lib/db/rc.ts`
- [x] `getDriverWithLinkedPlayer` replaces the inline two-query pattern at `drivers/[driverId]/page.tsx:24-30` — confirmed: those lines exist
- [x] `searchPlayers` placed in `lib/db/queries.ts` — confirmed: this file holds `findPlayerByDiscordId`, `leaderboardForGame`, `overallLeaderboard`; the player-read surface is here, not in `players.ts` (bootstrap only)
- [x] `canEditRace` (global_admin gate) confirmed in `lib/permissions.ts:23-25`
- [x] `LapChart` chip rendering uses `<li>` elements today — can be converted to `<button>` without restructuring; the `onPointerDown` / `onPointerUp` / `onPointerCancel` / `onPointerMove` handler pattern is valid on `<button>`
- [x] `app/racing/[raceId]/page.tsx` has a `<main className="p-4">` (line 55) — the `max-w-4xl mx-auto` addition is a straightforward class change
- [x] Race detail page currently calls `computeDriverStats` per-driver in the lap-by-lap loop (lines 156-163) — refactoring to compute once into a map and pass to compare is a clean refactor
- [x] `app/racing/drivers/[driverId]/page.tsx` fetches the driver row at line 22, renders existing content — Phase C extends with `getDriverWithLinkedPlayer` and admin UI section
- [x] `lapChartClipMaxY` is exported from `LapChart.tsx` and pinned by its own test — must not be changed; filtering happens at call site
- [x] Phase A — 5 page files listed for `max-w-4xl mx-auto` wrap
- [x] Phase B — `RaceChartSection` client wrapper holding visibility state
- [x] Phase B — `LapChart` `visibleDriverIds` prop with default "all visible" preserves backward compat
- [x] Phase C — `setDriverPlayer`, `getDriverWithLinkedPlayer`, `searchPlayers`, PATCH route, `DriverPlayerLink`, `GET /api/players/search`
- [x] Phase D — `CompareDriversSection` with URL-persisted `?compare=` state, FIFO 4th-selection replacement, stale-ID filtering
- [x] Stale URL IDs handled: `initial` filter drops IDs not in the race's driver list (plan line 641-642)
- [x] `computeDriverStats` double-compute rationale addressed — O(N) over ~20 laps, refactor-to-map is correct
- [ ] iOS Safari context-menu suppression missing from Phase B long-press spec (gap — see finding 1)
- [ ] `useEffect` URL sync fires spuriously on mount with empty selection (gap — see finding 2)
- [ ] LIKE `%` and `_` escaping in `searchPlayers` (gap — see finding 5)
- [ ] `GET /api/players/search` absent from canonical files table (gap — see finding 4)
- [ ] Y-axis rescale-on-toggle-back not explicitly acknowledged (gap — see finding 3)

---

## Strengths worth keeping

- **Schema is genuinely ready.** `rc_drivers.player_id` is nullable FK with no extra migration needed. The plan's claim (Q-H5-12) is verified correct. The Phase C approach of writing to an already-typed column rather than adding one is the right scope discipline.

- **`lapChartClipMaxY` filter-at-call-site approach is correct.** The plan correctly keeps `lapChartClipMaxY`'s signature unchanged and proposes filtering the input array at the call site. This preserves the export contract and the pinned test in `tests/unit/lap-chart-clip.test.ts`.

- **FIFO queue for 4th-driver selection is the right UX.** The alternative (blocking the 4th tap) would frustrate operators who want to swap one driver out of a comparison. FIFO matches user expectation ("my last taps are what I want to see") and the existing Discord precedent cited in Q-H5-9.

- **`longPressFired` ref pattern correctly prevents toggle-after-isolate.** The sequence is: `onPointerDown` → timer fires → `longPressFired = true` → isolate called → `onPointerUp` fires → `timer.current` is null (cleared by `cancel()`) → the `if (timer.current)` guard is false → toggle not fired. The logic is correct and the pin-to-a-comment is warranted.

- **Refactoring `computeDriverStats` to compute once is the right call.** The current page already computes stats in the lap-by-lap loop. Factoring into a map and reusing for the compare table avoids double-computing and makes the data flow explicit. The plan correctly identifies the existing pattern (page.tsx:156-163) and proposes a clean refactor rather than a hack.

---

## Positions on the 6 flagged clarifying questions

1. **Symbol update needed? (Q-H5-14, CQ1):** No update needed. The `racing` symbol describes domain grain (display-only, anonymous-readable, admin-uploaded) — a UI affordance for an already-typed column is not at that grain. The reviewer confirms: keep symbols stable; revisit when R2 adds ELO integration. If the team later adopts a convention of documenting all admin surfaces in the symbol, a batch update at that time is cleaner than piecemeal additions now.

2. **`searchPlayers` in `queries.ts` vs `players.ts` (Q-H5-14, CQ2):** `lib/db/queries.ts` is correct. On inspection: `lib/db/players.ts` is the Discord bootstrap module — it creates and promotes players on OAuth sign-in. `lib/db/queries.ts` holds all read-side player helpers (`findPlayerByDiscordId`, `leaderboardForGame`, `overallLeaderboard`). A player search is a read-side player query; it belongs in `queries.ts`. Moving `findPlayerByDiscordId` and friends into `players.ts` would be a refactor with no functional change and would break the clean import in `players.ts` which already imports `findPlayerByDiscordId` from `queries.ts`. Confirmed: land `searchPlayers` in `queries.ts`.

3. **`GET /api/players/search` auth gate (CQ3):** Admin-gated is correct. The alternatives: (a) Server Action — more idiomatic for Next.js App Router but adds plumbing (`useActionState` or manual debounce around a server action call from a client component), and does not meaningfully reduce code; (b) admin-gated REST endpoint — the current plan's choice: a 15-LOC route, clean, tested via integration tests, and matches the precedent set by all other admin API routes in this codebase; (c) any-authenticated-user endpoint — unnecessary disclosure. The player table is small for a Discord-community app, but `display_name` + `discord_handle` is PII. Keeping it admin-only is the correct default; the gate can always be widened later (the Hand-offs already note this). Confirmed: admin-gated GET endpoint.

4. **URL sync `useEffect` vs synchronous `router.replace` in toggle callback (CQ4):** Switch to calling `router.replace` inside the `toggle` callback directly, rather than in a `useEffect`. The `useEffect` form has the mount-spurious-replace bug identified in finding 2, and the "easier to read" argument does not outweigh the correctness issue. Synchronous replace in the callback is 2 lines, eliminates the effect dependency array concern, and cannot fire spuriously on mount. This resolves finding 2 entirely.

5. **Hide compare section when `drivers.length < 2` (CQ5):** Hide the section entirely when `drivers.length < 2`. The "Select at least 2" message for a 1-driver race is confusing because the operator cannot satisfy the prompt no matter what they do. Hiding the section is 2 lines (`if (drivers.length < 2) return null;` at the top of `CompareDriversSection`) and gives a cleaner experience for DNS/no-show edge cases. The operator's attention is not drawn to a UI that can't function.

6. **Long-press keyboard accessibility (CQ6):** Defer to H6 or a dedicated accessibility task, as the plan suggests. The plan's existing toggle-via-keyboard path (tab to chip, Enter/Space to toggle) already covers the functional use case by a different route: keyboard users can hide every other driver one by one. Adding a Shift+Enter isolate shortcut is a one-line `onKeyDown` handler but should be bundled with a broader keyboard-accessibility audit rather than bolted onto Phase B in isolation. Confirmed: out of scope for H5; flag in Hand-offs (already present).

---

## Recommended follow-ups for the implementer

1. **[Finding 1 — MAJOR]** Add `onContextMenu={(e) => e.preventDefault()}` and `className="... touch-none"` to the `DriverChip` `<button>`. Add a comment: `// Suppress iOS Safari context-menu on long-press; touch-none prevents system text-selection gesture.` Without this, the isolate gesture will collide with Safari's system long-press popover on real iPhones at exactly the 500ms threshold chosen.

2. **[Finding 2 — MAJOR]** Replace the `useEffect` URL sync with a synchronous `router.replace` call inside the `toggle` callback (addresses CQ4 at the same time). Remove the `useEffect` entirely. Pattern:
   ```tsx
   const toggle = (id: string) => {
     setSelected((prev) => {
       const next = /* ... FIFO logic ... */;
       const qs = next.length > 0 ? `?compare=${next.join(',')}` : window.location.pathname;
       router.replace(qs, { scroll: false });
       return next;
     });
   };
   ```
   This eliminates the mount-spurious-replace bug and keeps the URL sync co-located with the state mutation.

3. **[Finding 5 — MINOR]** Escape LIKE metacharacters in `searchPlayers`: replace `%` and `_` in `trimmed` before constructing the `like` variable. Add `ESCAPE '\\'` to both `LIKE ?` clauses in the SQL. Add a test case: `searchPlayers(db, 'user_name')` returns only the exact handle `user_name`, not handles like `userXname`.

4. **[Finding 4 — MINOR]** Consolidate the file table at the top of `h5-race-detail-qol.md` to include `app/api/players/search/route.ts` (new). The current plan has it in a second mini-table appended mid-Phase C prose — a downstream agent reading only the canonical table will miss it.

5. **[Finding 6 — MINOR]** Explicitly state in the test plan that `initialSelected?: string[]` is the definitive test seam for `CompareDriversSection` URL-state tests, not a fallback. Mock `useSearchParams` is harder in vitest jsdom than the seam approach; commit to the seam and document it as the pattern.

6. **[CQ5 — MINOR]** Add `if (drivers.length < 2) return null;` at the top of `CompareDriversSection`. 1-driver races render a confusing section that can never be satisfied.
