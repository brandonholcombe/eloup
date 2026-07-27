# UX2 — Screen redesign: contrast, component adoption, flows, polish

## Author: claude-opus-4.8-ux2-implementer
## Status: In Progress

## Reviewer findings folded (2026-07-26)

Review at `Agents/Review-reports/ux2-screens-review.md` (Reviewer:
`claude-opus-4.8-ux2-reviewer`): **Approve-with-changes** — 1 blocking, 5
should-fix, 4 optional. Folded:
- **BLOCKING — `<Card asChild>` isn't executable yet.** `components/ui/card.tsx`
  is a plain forwardRef div with NO Slot support (unlike `button.tsx`). As-is,
  `asChild` would spread onto the div and still render a div (wrapping, not
  replacing, the `<li>`/`<Link>`). **First step of 2a: add `@radix-ui/react-slot`
  Slot support to `card.tsx`** (dep already installed). Then the class-merge is valid.
- **"Markup-only" items that are actually new engineering:** (a) 2c **"your rank"**
  — `app/leaderboards/page.tsx` never calls `auth()` and fetches only a top-50
  slice; needs a session + a new rank query, not a render tweak. (b) 2b **1v1
  auto-seed** logic risks: `eligiblePlayers[0]` can be the viewer (→ two rows,
  same player — must dedupe), and `rows` re-seeds only on tournament change
  (`NewMatchForm.tsx:95`), NOT on game/format change — needs a format-keyed effect
  or the 1v1 seed won't fire on game switch.
- **Contrast sweep must be SELECTIVE (should-fix):** ~50 `text-slate-500`
  usages, but some are intentionally dim — e.g. the faded outlier rows at
  `racing/[raceId]/page.tsx:289`. Do NOT blanket-brighten; exclude intentional
  dims.
- **Button facts corrected:** 28 raw `<button>`s (not 26); admin button is
  **amber-600** (not "orange"); a naive `<Button>` swap shrinks 44px→`h-9` — pin
  `h-tap` on every swap (per UX0/UX1).
- **Sizing:** implement/review **2a → 2b → 2c → 2d as SEPARATE cycles** (2a's
  Card/Button capabilities are the foundation 2b/2c reuse). 2a is test-safe
  (no test asserts swept markup; chips excluded).

## Parent

Phase 2 of `ux-overhaul-plan.md`. Absorbs the deferred Phase-1 `<Card>`/`<Button>`
component adoption AND the h9 P2 backlog. Grounded in a full-app visual review
(2026-07-26) of all public + gated pages at 390px with seeded data — screenshots
via the local harness (seeded SQLite + forged Auth.js session cookie + Playwright;
see `scripts/ui-shots.mjs` / `scripts/ui-shots-gated.mjs`, throwaway/untracked).

## Verification loop (use for every sub-part)

A reusable local screenshot loop exists and MUST be used to verify each screen
change (the browser MCP is unavailable):
1. Seed: `NODE_PATH=./node_modules node <scratchpad>/seed.js <db>`.
2. `next dev` with `DATABASE_PATH=<db>` + dummy auth env on :3100 (hot-reloads).
3. Mint cookie via `next-auth/jwt` `encode` (salt `authjs.session-token`).
4. `node scripts/ui-shots-gated.mjs` → PNGs → eyeball before/after each change.

## Sub-parts (each its own commit + full verify + visual before/after)

### PART 2a — Foundation sweep (contrast + component adoption)
The app-wide base the rest builds on. **Own commit + review cycle.**
- **2a.0 PREREQUISITE — add Slot/`asChild` to `components/ui/card.tsx`** (Blocking
  fix). Mirror `button.tsx`: `const Comp = asChild ? Slot : 'div'`. Without this,
  the Card row adoption below is a no-op. `@radix-ui/react-slot` already installed.
- **Contrast (review #1) — SELECTIVE:** move section labels + meta text
  (profile `OVERALL`/`BY CATEGORY`/`GAMES`, tournament `STANDINGS`/`INVITE LINK`/
  `MEMBERS`, racing meta, form hints) from `text-slate-500` to
  `text-muted-foreground`, and set `--muted-foreground` to **slate-400**. **Do NOT
  blanket-sweep** — EXCLUDE intentionally-dim text such as the faded outlier lap
  rows at `racing/[raceId]/page.tsx:289`. Audit each of the ~50 `text-slate-500`
  sites; only convert genuine "muted label/meta" uses.
- **Card adoption (review #4, deferred from 1a):** after 2a.0, convert the
  tokenized `<li>`/`<Link>`/`<section>` card rows to `<Card asChild>` (Slot
  preserves the host element). Pixel-diff each.
- **Button variants (review #3/#4, deferred from 1b):** roll the **28** inline
  `<button>`s to `<Button>` — blue→`default`, slate→`secondary`, red→`destructive`;
  add a **`warning`** variant (amber, matching the current **amber-600** admin
  button) for "Force confirm (admin)". **Pin `h-tap` on every swap** (default
  `<Button>` is `h-9`/36px → would break the H8 44px target). Exclude the
  LapChart/CompareDrivers toggle chips. Preserve `disabled`, `aria`, `'use server'`.

### PART 2b — Core flow ergonomics (h9 P2)
- **Match entry (review #2):** for `1v1`, auto-seed TWO participant rows and a
  one-tap winner toggle that sets placements (no manual number typing); pre-fill
  placements sequentially for FFA. Add `inputMode="numeric"` + `enterKeyHint` +
  clamp (`max={rows.length}`, reject `<1`) on the placement input.
  - **Logic fixes (reviewer):** (1) the second auto-seeded row must **dedupe** —
    `eligiblePlayers[0]` can be the viewer, yielding two identical players; pick
    the first eligible player who is NOT already seeded. (2) `rows` currently
    re-seeds only on tournament change (`NewMatchForm.tsx:95`) — add a
    **format/game-keyed effect** so switching to a 1v1 game actually triggers the
    2-row seed (else it never fires on game switch).
- **Confirm reachability:** sticky bottom "Confirm my row" bar on `/matches/[id]`
  when the viewer's row is unconfirmed and below the fold (large FFA/team).
- **a11y:** `role="alert"` on the submit/confirm error `<p>`s (H8 review deferral).

### PART 2c — Stat & ranking polish
- **State coloring (review #5):** deltas green/red (`+15`/`-10`), `pending` amber,
  `confirmed` muted-green — on profile RECENT + match rows.
- **Stat hierarchy (review #5):** profile numbers as proper stat tiles rather
  than mono runs; fix "1 games" → pluralize correctly.
- **Top-3 medals (review #6):** gold/silver/bronze rank treatment on leaderboards
  + tournament standings ranks 1–3.
- **"Your rank" affordance (NOT a render tweak — reviewer):** requires new
  engineering — `app/leaderboards/page.tsx` never calls `auth()` and fetches only
  a top-50 slice. Needs a session read + a new "rank of player X" query
  (`COUNT(*) WHERE rating > me`) to surface the signed-in player's position when
  outside the visible top-N. Scope accordingly (not a pure UI change).

### PART 2d — Racing density (review #7, lower priority)
Group the race list by date and add separation; tighten the dense card meta.
Defer if 2a–2c fill the phase.

## Scope guards / non-goals
- No data-viz rework (Phase 3), no motion (Phase 4), no SW/offline (Phase 5).
- The `Shorline 3` typo is DATA (imported track name), not a UI change — out of
  scope; flag to the user separately.
- No schema/auth/rating/deployment changes; presentation only. If a tracked
  symbol is touched, re-run `align.py lock`.

## Testing / verification (per sub-part)
- `pnpm lint` / `typecheck` / `build` / `test` green after EACH sub-part.
- Visual before/after via the screenshot loop for every screen touched.
- First-load JS vs the UX1 baseline (shared 100KB); flag any route nearing 150KB.
- Watch for tests asserting swapped markup (esp. `lap-chart-visibility.test.ts`
  class assertions — keep chips excluded).

## Review gate
Edits `eloup-web/`; needs an independent review report in
`Agents/Review-reports/` by a different agent than `## Author:`, referencing
`ux2-screens.md`, before implementation. Given the size, review may recommend
implementing/reviewing the sub-parts (2a–2d) as separate cycles.
