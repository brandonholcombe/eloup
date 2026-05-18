# Review: h7-profile-expansions.md

## Reviewer: claude-sonnet-4-6-h7-reviewer
## Date: 2026-05-18
## Verdict: APPROVE-WITH-CHANGES

## Summary

The H7 plan in `h7-profile-expansions.md` is well-scoped and technically grounded across its
five phases. The schema migration is correct, the categories module is clean, the `driverWinLossStats`
aggregation is sound, and the `GameCategoryEditor` component mirrors the established H5 pattern
faithfully. Two issues require resolution before commit 4: test case 5 has a copy-paste
arithmetic error (the sum `21200` is taken from Flow 1's three-game fixture and applied to a
two-game fixture whose correct sum is `19000`, yielding `1357` not `1514`); and the Career stats
`<dl>` rendered with `grid-cols-4` will visually break — five divs in a four-column grid causes
the `all` totals row to wrap to a second row, misaligned with `practice`. A `<table>` is the
correct fix. The remaining findings are minor or cosmetic.

---

## Issues found

**1. [MAJOR] Test 5 arithmetic is wrong — `21200` is the sum for the three-game Flow 1 fixture,
not the two-game test 5 fixture**

The test plan for `tests/unit/queries.test.ts` test 5 reads:

> `playerCategoryRatings`: 2 racing games (1300×10g + 1500×4g) →
> one row with `rating = CAST(ROUND(21200/14) AS INTEGER) = 1514`.

`1300×10 + 1500×4 = 13000 + 6000 = 19000`, not `21200`. The `21200` figure is the numerator
for Flow 1's three-game racing fixture (`1300×10 + 1500×4 + 1100×2 = 21200`), which divides
over 16 total matches to yield `1325`. The copy-paste carried the wrong numerator into the
two-game test.

The correct expected value for test 5 is `CAST(ROUND(19000/14) AS INTEGER)`. `19000/14 ≈ 1357.14`,
which `ROUND` truncates to `1357`. The test name should read:
`rating = CAST(ROUND(19000/14) AS INTEGER) = 1357`.

An implementer following the task doc verbatim will write a test that expects `1514` from a fixture
that actually produces `1357`. The test will fail with a cryptic mismatch, not a clear signal that
the expected value is wrong.

**Required fix:** Correct test 5 to assert `weightedRating === 1357`, with the formula documented
as `CAST(ROUND(19000/14) AS INTEGER)`.

---

**2. [MAJOR] Career stats `<dl>` with `grid-cols-4` wraps the `all` row to a second row —
visual layout is broken at every viewport width**

Phase E's RC driver page uses:

```tsx
<dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
  <div> {/* header: Kind / Races / Wins / Podiums (4 <dt> stacked) */} </div>
  {winLoss.map((row) => (          {/* 4 rows: race, qualif, practice, all */}
    <div> ... </div>
  ))}
</dl>
```

`driverWinLossStats` returns 4 rows (`race`, `qualif`, `practice`, `all`). Combined with the
header `<div>`, that is 5 `<div>` children inside a `grid-cols-4` container. CSS grid places
them: header in column 1, race in column 2, qualif in column 3, practice in column 4, then `all`
wraps to row 2 column 1 — directly beneath the header div. The `all` totals row appears under
the `Kind` header column, not in line with the other data rows. The layout is visually broken
on every viewport width, not just narrow ones.

Additionally, the header `<div>` contains four `<dt>` elements with no corresponding `<dd>`
elements — a malformed description list per the HTML spec (each `<dt>` in a `<dl>` requires an
associated `<dd>`). Using `<dl>` here is semantically incorrect for tabular data with a fixed
column structure.

The plan itself says "Implementer may swap the `<dl>` for a `<table>`." The reviewer is pushing
that direction: use `<table>` unconditionally. A `<table>` handles five rows correctly by design,
and its header/body distinction (`<thead>` / `<tbody>`) maps cleanly to the data shape. Tailwind
can style the table cells with the same `rounded-md border border-slate-800 bg-slate-900` aesthetic
applied per cell or per row.

**Required fix:** Replace the `<dl>` + `grid-cols-4` with a `<table>`. Use `<thead>` for the
header row and `<tbody>` for the four data rows. Apply `text-xs` and `tabular-nums` as needed.
This eliminates the wrap bug and the semantic malformation simultaneously.

---

**3. [MINOR] `playerCategoryRatings` rounds in SQL (banker's rounding) while the profile page
rounds per-game ratings in JS (`Math.round` = round-half-up) — produces visible inconsistency
for a single-game category**

`playerCategoryRatings` uses `CAST(ROUND(...) AS INTEGER)` in SQLite. SQLite's `ROUND` uses
banker's rounding: `ROUND(1200.5) = 1200` (rounds to the nearest even integer). The profile page
renders per-game ratings as `{Math.round(r.currentRating)}`. JS `Math.round(1200.5) = 1201`.

For a player with exactly one game in a category whose `current_rating` is `1200.5`, the "By
category" section will show `1200` while the "Games" section immediately below will show `1201`
for the same game. The inconsistency is visible on a single page load.

**Required fix:** Pick one rounding path and use it everywhere. The recommended fix is to drop
the SQL `ROUND` and return the raw floating-point value from `playerCategoryRatings`, then
apply `Math.round(c.weightedRating)` in the JSX (matching the existing per-game pattern).
This keeps all rounding in JS (round-half-up) and eliminates the split-rounding footgun.
Change `weightedRating: number` to reflect that it carries a float until the UI rounds it.

---

**4. [MINOR] Test 7 (rounding ties) pins "a deterministic integer" but does not commit to
the exact value — the test name says it pins the SQLite behavior but the spec is underspecified**

Test 7 reads:

> `playerCategoryRatings`: rounding ties — SQLite's banker's rounding for `.5` produces
> a deterministic integer. Pin the exact value the implementation returns
> (document the rounding mode in the test name).

Saying "pin the exact value the implementation returns" means "write the test after seeing what
the implementation produces" — a tautological pin. A useful pin must specify the input fixture
AND the expected value in advance, so the test can catch a regression if the rounding mode
changes.

If finding 3 is adopted (move rounding to JS), this test becomes a `Math.round` test and the
behavior is unambiguous. If SQL `ROUND` is retained, the fixture should be:
- Input: one game with `current_rating = 1350.5`, `games_played = 1`.
- Expected `weightedRating`: `1350` (SQLite banker rounds to even; `1350` is even).
- Document explicitly: `ROUND(1350.5) = 1350`, not `1351`.

**Required fix:** Replace "pin the exact value the implementation returns" with an explicit
fixture and expected value as above. If finding 3 is adopted, update to use a JS `Math.round`
fixture instead.

---

**5. [MINOR] `POST /api/games` currently returns `403` for unauthenticated requests; the new
`PATCH /api/games/[gameId]` correctly returns `401` — the inconsistency is not H7's creation
but H7's PATCH adds a second inconsistency surface**

The existing POST handler (`app/api/games/route.ts:33`) returns `{ error: 'forbidden' }` with
status `403` for both unauthenticated and unauthorized users (`canCreateGame(null)` returns
`false`, and the handler has no `player ? 403 : 401` branch). The PATCH handler in the plan
correctly uses the `player ? 403 : 401` distinction (matching H5's `setDriverPlayer` route).

This creates a situation where the same admin surface (`/api/games`) returns different status
codes for unauthenticated access depending on the HTTP method. While H7 is not the root cause,
the PATCH handler's correct behavior implicitly highlights the POST's deficiency. If the
implementer notices this while writing the PATCH integration test and fixes the POST too, that
is fine — but if they notice it after the tests are written, a mid-phase fix risks test drift.

**Required fix:** Proactively add `player ? 403 : 401` to the existing POST handler's auth
check when implementing Phase C. This is a 2-line change co-located with the POST body schema
extension already required by Phase C. List it as an explicit change site in the task doc.

---

**6. [NIT] `groupByCategory` is described as "local helper (page-scoped or inline reduce)" — no
canonical implementation is given, leaving the implementer to invent the shape**

Phase D says "`groupByCategory(rows)` is a local helper (page-scoped or inline reduce)." The
function does not appear in the file table or the test plan. For a function used only in one
server component, inline `reduce` is fine — but the lack of a spec means the implementer might
write `Object.groupBy` (Node 21+ only, not universally available in all Next.js runtimes) or
a `Map`-based group (correct but verbose). The plan should specify: use `Array.prototype.reduce`
to build a `Record<string, GameRating[]>`, preserving insertion order (which is category-sorted
because `playerGameRatings` orders by `category, name`).

**No required fix**, but the implementer should note: `Object.groupBy` requires Node 21+ and
may not be in the tsconfig's `lib`. Use `reduce` or a `for` loop. Mention in a code comment.

---

**7. [NIT] `GameCategoryEditor`'s error display calls `resp.text().catch(...)` — this may
surface a raw JSON error envelope to the operator instead of the human-readable message**

The PATCH handler returns `NextResponse.json({ error: '...', detail: ... })` for 400 errors.
`GameCategoryEditor` reads the error via `resp.text().catch(...)` which yields the raw JSON
string `{"error":"invalid body","detail":{...}}`. The operator sees the stringified JSON, not
a clean message.

The existing `NewGameForm` does the same thing (`resp.text().catch(...)`), so this is a
codebase pattern, not an H7 regression. Mentioning it so the implementer is not surprised if
an operator files a "weird error text" report. The correct fix (parse JSON and extract
`data.error`) is out of scope for H7; flag it in Hand-offs.

---

## Coverage check

- [x] Migration 0008 `ALTER TABLE games ADD COLUMN category TEXT NOT NULL DEFAULT 'other'`
  verified correct — SQLite `ADD COLUMN` with `NOT NULL DEFAULT` atomically backfills existing
  rows since SQLite 3.32+. The `NOT NULL` + `DEFAULT` combination on `ADD COLUMN` is
  specifically allowed by SQLite 3.37+ (released 2021); better-sqlite3 ships a recent build.
  No `UPDATE games SET category = 'other' WHERE category IS NULL` is needed (it would be a
  no-op given the NOT NULL DEFAULT).
- [x] Migration pattern matches 0005 / 0006 exactly — one `ALTER TABLE ... ADD COLUMN` per
  file, no `IF NOT EXISTS` on the index (matches 0005 which also omits it; `schema_migrations`
  table prevents double-run).
- [x] `CREATE INDEX idx_games_category ON games(category)` — no `IF NOT EXISTS` needed given
  `schema_migrations` idempotency guard. Confirmed pattern: 0005 has no `IF NOT EXISTS` on its
  CHECK constraint, 0006 similarly bare.
- [x] `GAME_CATEGORY_SLUGS as [GameCategorySlug, ...GameCategorySlug[]]` cast is a runtime
  no-op but safe — the array is statically 8 elements, never empty. `z.enum` receives a plain
  string array at runtime and calls `arr[0]` / `arr.slice(1)` — works correctly.
- [x] `z.enum` rejects unknown slugs with a 400 via `parsed.success === false` → `status: 400`
  path. Confirmed in both POST and PATCH handler specs.
- [x] `z.string().refine(isKnownCategory)` alternative is valid and avoids the cast — the
  plan's preference for `z.enum` for literal-union inference is defensible; either works.
- [x] `playerCategoryRatings` `WHERE r.games_played > 0` filter — confirmed correct; prevents
  division by zero in categories containing only zero-match games (the rollup denominator
  `SUM(r.games_played)` would be zero, producing NULL or division-by-zero).
- [x] `playerGameRatings` including zero-match games while `playerCategoryRatings` excludes
  them — confirmed intentional asymmetry, correctly documented in the plan.
- [x] `driverWinLossStats` totals row computed in JS from the three already-in-memory kind
  rows — correct; avoids a SQL UNION ALL for no gain.
- [x] `driverWinLossStats` `placement <= 3` for podiums is inclusive of wins — correct.
- [x] `driverWinLossStats` `placement = NULL` defense: `SUM(CASE WHEN NULL <= 3 THEN 1 ELSE 0
  END)` evaluates the CASE to ELSE (SQLite three-valued logic), contributing 0 — correct.
- [x] Driver profile page currently uses `getDriverWithLinkedPlayer`, `perTrackBestsForDriver`,
  `recentRacesForDriver` — all confirmed in `app/racing/drivers/[driverId]/page.tsx`. H7 adds
  `driverWinLossStats` call below the admin-link block.
- [x] `GameCategoryEditor` mirrors H5's `DriverPlayerLink` (`useRouter` + `useTransition`
  pattern) — confirmed; `DriverPlayerLink` is in `components/DriverPlayerLink.tsx` and uses
  the same `start(async () => { ... resp ... router.refresh() })` shape.
- [x] `canCreateGame` reuse for PATCH — confirmed exported from `lib/permissions.ts` and
  already used in `app/api/games/route.ts:7`.
- [x] `getGame` import in PATCH handler — confirmed exported from `lib/db/queries.ts`.
- [x] `app/games/page.tsx` passes `currentCategory` to `GameCategoryEditor` — requires
  `GameRow` to include `category` field (confirmed: H7 adds it to `GameRow` type) and
  `listGames` to SELECT it (confirmed: `listGames` uses `SELECT *`, which picks up the new
  column after 0008 runs).
- [x] `lib/games/` directory is new — Dockerfile `COPY` of `lib/` subtree captures it
  automatically; no Dockerfile edit needed.
- [x] Symbol update: adding `game_categories_count: 8` to `app.properties` — confirmed
  described in Phase F with `python3 scripts/align.py lock` after.
- [x] Flow 1 arithmetic verified: `(1300×10 + 1500×4 + 1100×2) / 16 = 21200/16 = 1325` —
  correct. Yard rollup: KanJam excluded (`games_played = 0`), Cornhole only: `1400` — correct.
  ORDER BY rating DESC → Racing 1325, Bar 1350, Yard 1400 → displayed `1400, 1350, 1325`.
  Wait: plan shows `Racing 1325 · Bar 1350 · Yard 1400` but ORDER BY DESC should show
  `Yard 1400` first. The plan's display order in Flow 1 is `Racing, Bar, Yard` — this is
  **ascending**, not descending. The SQL is ORDER BY rating DESC, which produces 1400, 1350,
  1325. The plan's displayed output is wrong, but the SQL is right. The test (test 8) correctly
  pins ORDER BY DESC; the Flow 1 display is just documentation noise.
- [x] Flow 3 totals arithmetic: `12+8+3=23` races, `4+2+0=6` wins, `7+5+1=13` podiums —
  correct.
- [x] `PATCH /api/games/[gameId]` 401 vs 403 distinction — correctly mirrors H5's
  `setDriverPlayer` route using `player ? 403 : 401`.
- [ ] Test 5 arithmetic error — 21200 should be 19000, expected 1514 should be 1357 (finding 1).
- [ ] Career stats `<dl>` + `grid-cols-4` wraps `all` row — 5 divs in 4-column grid (finding 2).
- [ ] Rounding inconsistency between SQL `ROUND` (banker) and JS `Math.round` (half-up) (finding 3).
- [ ] Test 7 expected value underspecified (finding 4).
- [ ] POST `/api/games` still returns 403 for unauthenticated — not fixed by H7 (finding 5).
- [ ] Flow 1 display order in the doc shows ascending (1325, 1350, 1400) but SQL ORDER BY DESC
  would show descending (1400, 1350, 1325) — documentation inconsistency, not a code bug.

---

## Strengths worth keeping

- **`driverWinLossStats` constant-row shape is correct UX.** Emitting zero-rows for race kinds
  with no entries means the operator always sees a full 4-row table. An empty-row-hiding
  approach (only show rows with `totalRaces > 0`) would confuse operators: "why does this
  driver's career stats have no race row?" Zeros are informative.

- **`playerGameRatings` ORDER BY `category, name` enabling a single-pass group is clean.**
  The profile page can `reduce` over the sorted rows in one pass rather than sorting again on
  the client. The query ordering contract should be documented in a JSDoc comment since the
  page's grouping logic depends on it.

- **`GameCategoryEditor` Save-on-dirty pattern is correct for an admin form.** The button only
  appears when the selected value differs from `currentCategory`. An operator cannot
  accidentally submit a no-op change. This is the right UX for a bounded dropdown (as
  explicitly noted in the plan: "No debounce needed — bounded dropdown, not free-text").

- **No new table for category rollup is the right call.** A `category_ratings` table would
  require invalidation logic on every match confirm. The on-the-fly weighted-average query
  over the already-indexed `ratings` table is the correct tradeoff for the scale of this app.

- **`GAME_CATEGORIES as const` + `(typeof ...)[number]['slug']` pattern is idiomatic TS.**
  The categories module is straightforward, the `categoryLabel` fallback to raw slug is
  defensive without being clever, and `isKnownCategory` as a type guard is the right shape
  for validation call sites.

- **Phase ordering minimizes risk.** Schema first (A), then constants (B), then admin surface (C),
  then profile UI (D), then RC stats (E), then symbols (F). Each phase can be tested in
  isolation. Phases D and E have no inter-dependency beyond the schema.

---

## Positions on the 7 flagged clarifying questions

1. **POST `/api/games` default vs. required category (CQ1):** Confirm optional with DEFAULT
   `'other'`. The form always sends an explicit value; the schema default handles legacy curl
   clients and future automation. Required would break any tooling that omits the field — even
   the existing test harness, which does not include `category` in its seeded games. Keep optional.

2. **`z.enum` vs `z.string().refine(isKnownCategory)` (CQ2):** Use `z.enum` with the cast in
   the API routes. The literal-union inference on `parsed.data.category` is genuinely useful —
   it lets the INSERT statement accept the value without an `as GameCategorySlug` cast at the
   call site. The tuple cast is boilerplate, but it is a one-liner and the existing codebase
   has `z.enum(['1v1', 'team', 'ffa'])` as a direct precedent. Stay with `z.enum`. If TS ever
   rejects the cast, fall back to `.refine` — that is the right escape hatch, not the first choice.

3. **ORDER BY rating DESC vs. category alphabetical (CQ3):** Rating DESC is correct. The operator
   at a party wants to see "what am I best at?" at a glance, not "what categories exist in
   alphabetical order?" The alphabetical alternative is predictable but removes the signal.
   Keep rating DESC. If a future operator wants alphabetical, it is a one-line change.

4. **`playerGameRatings` includes zero-match games / `playerCategoryRatings` excludes (CQ4):**
   Confirm the intentional asymmetry. The per-game list is a registry ("what games does this
   player have a rating row for?"); the category rollup is a score ("how well is this player
   doing in this category?"). Including zero-match games in the rollup would produce a 1200
   starting rating in the average — noise, not signal. The asymmetry should be captured in a
   comment in `playerGameRatings` pointing at the corresponding filter in
   `playerCategoryRatings`.

5. **RC career stats `<dl>` vs `<table>` (CQ5):** Use `<table>`. The `<dl>` with `grid-cols-4`
   breaks at 5 children (finding 2). A `<table>` with `<thead>/<tbody>` handles this
   correctly, is semantically appropriate for tabular data with four columns, and is the first
   table on the page — which is fine. The H5 stat-grid aesthetic applies to the styling, not
   the element choice.

6. **Symbol property name (CQ6):** Use `game_categories_count` (the implementer's preference).
   It is verbose but sets a clear convention: a `_count` suffix signals "this tracks a
   quantity." If a future `game_category_list` property is added, the naming is consistent.
   `game_categories: 8` would be ambiguous (is `8` a list? a slug?). `game_categories_count`
   wins.

7. **0008 migration backfill (CQ7):** No explicit `UPDATE games SET category = 'other' WHERE
   category IS NULL` needed. SQLite's `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 'other'`
   atomically backfills all existing rows as of the ADD COLUMN execution. The `NOT NULL`
   constraint on an `ADD COLUMN` is explicitly supported when a DEFAULT is provided (SQLite
   3.37.0+, released November 2021). A belt-and-suspenders UPDATE would be a no-op and would
   silently succeed — harmless, but cargo-culted. Omit it; the migration is correct as written.

---

## Recommended follow-ups for the implementer

1. **[Finding 1 — MAJOR]** Correct test 5: `1300×10 + 1500×4 = 19000`, not `21200`.
   Expected `weightedRating = 1357`. Update the test name to read
   `CAST(ROUND(19000/14) AS INTEGER) = 1357`. The Flow 1 example (21200/16 = 1325) is
   correct and can remain in the prose.

2. **[Finding 2 — MAJOR]** Replace the Career stats `<dl>` + `grid-cols-4` with a `<table>`.
   Use `<thead>` for the header row and `<tbody>` for the four data rows (race / qualif /
   practice / all). Apply `text-xs` per cell and the existing `border-slate-800 bg-slate-900`
   styling per `<tr>` or per `<td>` as appropriate.

3. **[Finding 3 — MINOR]** Move the category rollup rounding from SQL to JS: return the raw
   float from `playerCategoryRatings`, render it as `{Math.round(c.weightedRating)}` in the
   JSX. This aligns with the existing `{Math.round(r.current_rating)}` pattern used everywhere
   else on the profile page. Update the `CategoryRollup` type comment to note `weightedRating`
   is a float. Update test cases to use the JS rounding expectation (`Math.round`).

4. **[Finding 4 — MINOR]** Rewrite test 7 with an explicit fixture: `current_rating = 1350.5,
   games_played = 1` → `weightedRating = 1351` (after adopting finding 3's JS rounding path).
   If SQL ROUND is retained, use `ROUND(1350.5) = 1350` (banker's even) and document the
   mode explicitly in the test name.

5. **[Finding 5 — MINOR]** Add `player ? 403 : 401` to the existing POST handler's auth
   check in `app/api/games/route.ts` as part of Phase C. This is co-located with the body
   schema extension and costs 2 lines. Update the POST integration test (test 18) to assert
   `401` for unauthenticated POST as well.
