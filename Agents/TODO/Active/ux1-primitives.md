# UX1 — Component primitives: Card/Badge/Skeleton sweep + Button rollout + Lucide nav

## Author: claude-opus-4.8-ux1-implementer
## Status: In Progress

## Reviewer findings folded (2026-07-20)

Independent review at `Agents/Review-reports/ux1-primitives-review.md`
(Reviewer: `claude-opus-4.8-ux1-reviewer`) returned **Request-changes** — 2
blocking, 4 should-fix, 4 confirmations. Approach and Phase-0 tokens verified
sound; lucide-react 1.25.0 confirmed authentic; skeleton/nav/padding claims
verified. Corrections folded below:
- **B1 (blocking):** the card-string sweep hits non-`<div>` hosts — an `<svg>`
  (`LapChart.tsx:105`) and a native `<details>` (`racing/[raceId]/page.tsx:261`)
  — that a `<Card>` (div) would break. Now an explicit **include/exclude list**
  (§ Part 1a).
- **S1:** two more non-plain cards — a `<p>` (`LapChart.tsx:66`) and an
  interactive `<Link>` (`profile/page.tsx:133`). Real clean-swap count is **~16**,
  not 21. `profile:133` special-cased.
- **S2:** `TournamentStandings` + `RaceAdminPanel` do NOT contain the exact
  string (near-miss variants: `border-blue-500` active, `border-slate-700`,
  `bg-slate-900/60`). Handled explicitly, not via the exact-string sweep.
- **S3:** the LapChart + CompareDrivers `rounded-full` toggle chips map to no
  Button variant and `lap-chart-visibility.test.ts` asserts their classes —
  **excluded** from the button rollout (they're toggles; a `Toggle` primitive is
  Phase 2).
- **S4:** **split into Part 1a (primitives + card sweep + skeleton) and Part 1b
  (buttons + Lucide nav)** — two separate commits, each independently verified.
  Button shadow/`hover:bg-primary/90` shift acknowledged as a minor accepted
  change (or neutralized) — no longer claimed "fully stable."

## Parent

Phase 1 of `ux-overhaul-plan.md`. Builds on Phase 0 (`ux0-design-foundation.md`,
Complete — shadcn scaffold + tokens live). Decisions locked: systematize+polish,
shadcn/ui, Lucide icons, dark-only.

## Goal

Kill the hand-copied UI duplication by routing every card/button/badge/skeleton
through shared primitives, and swap the nav's emoji for Lucide icons. Outcome:
one source of truth per element; net LOC down. **Structurally DRY + tokenized,
with ONE intended visual change: nav icons (emoji → Lucide).** Everything else
stays visually stable — the primitives are themed to the CURRENT look, not
shadcn's defaults.

## ⚠️ Critical: primitives must match the current look, NOT shadcn defaults

The new-york defaults differ from what the app renders today. Naive adoption =
visible regressions. Reconcile in each primitive:

- **Card:** new-york `Card` is `rounded-xl border bg-card text-card-foreground
  shadow`. The app's rows are `rounded-md border border-slate-800 bg-slate-900`
  (no shadow). Since `--card` = slate-900 and `--border` = slate-800 (Phase 0),
  `bg-card` + `border` already match; but the primitive MUST use **`rounded-md`
  and no `shadow`** to match. Theme the generated `card.tsx` accordingly.
- **Badge:** new-york `Badge` is `rounded-md border px-2.5 py-0.5 text-xs
  font-semibold`. Map existing inline pills/tags to the closest variant; verify
  padding/weight don't shift visibly. Most current tags are `text-xs` — align.
- **Skeleton:** shadcn `Skeleton` is `animate-pulse rounded-md bg-primary/10`.
  The H8 `components/Skeleton.tsx` uses `bg-slate-800`. Keep the **slate-800**
  fill (or `bg-muted`) so the existing loading.tsx skeletons look unchanged.

## Scope — split into Part 1a and Part 1b (S4); each its own commit + verify

### PART 1a — primitives + card sweep + skeleton

#### 1a.1 Add primitives (themed to current look)
- `components/ui/card.tsx` — shadcn Card family, rethemed to **`rounded-md`,
  `border`, `bg-card`, NO shadow** (new-york default is `rounded-xl … shadow` —
  C4). `--card`=slate-900 / `--border`=slate-800 already match. **Do NOT wrap
  row content in the default `<CardContent>` (`p-6`)** — row cards use `<Card
  className="px-3 py-2">` (or `p-3`) with content inline, or cards get fatter.
- `components/ui/badge.tsx` — shadcn Badge; variants themed to current pills.
- `components/ui/skeleton.tsx` — shadcn Skeleton with `bg-muted` (= slate-800).

#### 1a.2 Card-string sweep — explicit include/exclude (B1, S1, S2)
The exact string `rounded-md border border-slate-800 bg-slate-900` has 21 hits,
but only ~16 are plain `<div>` cards. **INCLUDE** (swap to `<Card>`): the plain
`<div>` card sites in `matches/[id]`, `matches/page`, `racing/*`, `tournaments/*`,
`leaderboards`, `InviteCard`, `MemberRow`, and the profile non-interactive cards.
**EXCLUDE (do NOT swap — would break the host element):**
- `components/LapChart.tsx:105` — the string is on an `<svg>`. Leave as-is.
- `components/LapChart.tsx:66` — on a `<p>` empty-state. Leave as `<p>`.
- `app/racing/[raceId]/page.tsx:261` — on a native `<details>` disclosure.
  Restyle in place if needed; a `<Card>` div removes expand/collapse. Leave.
- `components/Skeleton.tsx:14` — skeleton row template (rebuilt in 1a.3, not a
  card).
**SPECIAL-CASE:** `app/profile/page.tsx:133` — the string is on an interactive
`<Link>` with `hover:bg-slate-800`+`focus-visible`. Use `<Card asChild><Link
…></Card>` (Slot forwards to the anchor) OR keep the `<Link>` and only leave its
classes; do NOT drop the anchor.
**NEAR-MISSES the exact sweep MISSES — handle explicitly (S2):**
- `components/TournamentStandings.tsx:21-24` — conditional `border-blue-500`
  (active) vs `border-slate-800`. Map to `<Card>` + a conditional
  `border-blue-500` className for the active row.
- `components/RaceAdminPanel.tsx:42/54/62` — `border-slate-700`,
  `bg-slate-900/60`, `bg-slate-900/40`, some `rounded` (not `rounded-md`). Either
  bring under `<Card>` with matching className overrides, or leave and note.
  Decide per-site; do not silently leave them inconsistent.
**Pixel-diff each swept surface** — the Card theme must reproduce the row exactly.

#### 1a.3 Skeleton replacement
Rebuild `components/Skeleton.tsx`'s `SkeletonBar` on `components/ui/skeleton.tsx`,
**preserving the `SkeletonRows`/`PageSkeleton` signatures** (all 8 `loading.tsx`
import only `PageSkeleton` — C2, so they stay untouched). Loading states unchanged.

### PART 1b — button rollout + Lucide nav (separate commit)

#### 1b.1 Button rollout — with chip exclusions (S3)
Replace inline `<button>`/submit elements with `<Button>`, variant per look:
- solid (`bg-blue-500`/primary) → `default`; backgroundless/text → `ghost` (+
  `hover:bg-transparent` where there's no hover bg, per the UX0 sign-in pattern);
  destructive/red → `destructive`.
- Pin `h-tap`/`w-full` via `className` (shadcn sizes are 36–40px; H8's 44px must
  survive). Preserve `disabled`, `aria-*`, and `'use server'` actions (compose,
  don't cross into a client boundary — UX0 BottomNav pattern).
- **Button shadow/hover shift (S4):** the `default` variant adds `shadow` and
  uses `hover:bg-primary/90`, vs current shadow-less `hover:bg-blue-400`. Either
  add `shadow-none` + realign hover in `className` (preferred, keeps stable), or
  accept it as a minor documented change. Pick one and be consistent.
- **EXCLUDE the toggle chips (NOT buttons):** `components/LapChart.tsx` visible/
  hidden `rounded-full` chip (`border-dashed`/`opacity-40`) and
  `components/CompareDriversSection.tsx:102` `aria-pressed` chip. They map to no
  shadcn Button variant, and `tests/unit/lap-chart-visibility.test.ts:60-70`
  asserts `opacity-40`/`border-dashed` on rendered markup — a swap breaks it. A
  `Toggle` primitive is a Phase-2 concern. Leave both as-is.

#### 1b.2 Nav icons: emoji → Lucide (the one intended visual change)
In `components/BottomNavItems.tsx` (type + `{it.icon}` → `<it.icon/>`) AND
`components/BottomNav.tsx` (the items array + sign-in), swap the 6 emoji for
Lucide icons: Boards→`Trophy`, Racing→`Car`, Matches→`Dices`, Cups→`Medal`,
Me→`User`, Sign in→`LogIn`. Change `NavItem.icon` from `string` to a Lucide
component type. Give each an explicit `size` (~22px) + `className` (`text-lg`
sizes a glyph, NOT an SVG — C3); `aria-hidden`; inherit `currentColor` so the H8
active-tab color logic still applies. **Keep emoji for game/category tags**
elsewhere (SVG for nav+controls only).

## Out of scope (deferred)
- **Select/Tabs/Dialog/Sheet/Sonner** — introduced in **Phase 2** where the
  screens that need them are redesigned. Native `<select>` stays for now
  (converting to Radix Select is a behavior + color-scheme interaction, Phase 2).
- Contrast bump (`slate-500`→`400`), match-entry ergonomics, sticky confirm,
  table overflow — all **Phase 2**.
- No motion beyond what the primitives ship with (Phase 4).

## Testing / verification (run the full gate after EACH of 1a and 1b)
- `pnpm lint` / `typecheck` / `build` / `test` all green after Part 1a, then
  again after Part 1b. Tests are mostly swap-safe (assert text/structure), BUT
  the excluded LapChart/CompareDrivers chips must stay untouched precisely
  because `lap-chart-visibility.test.ts:60-70` asserts `opacity-40`/`border-dashed`
  (S3). `nav-active.test.ts` asserts the pure `isNavItemActive` fn (no render),
  so it survives the Lucide swap (C3). If any swept surface has a test asserting
  its markup, update that test in the same commit.
- First-load JS: `<Button>`/`<Card>` pull primitives into more client bundles;
  `lucide-react` icons are per-icon tree-shaken. Measure each route vs the UX0
  baseline (shared 100KB, /games 112KB) after each part; flag any route nearing
  the 150KB ceiling.
- Manual 390px smoke: after 1a, every swept card/skeleton surface is
  pixel-identical (excludes untouched). After 1b, buttons unchanged (modulo the
  documented shadow/hover decision) and nav icons are the one intended change;
  44px targets intact; active-tab highlight still works with the Lucide icons.
- No symbol change expected (`ui_lib` already `tailwind_shadcn`); `align.py
  check` OK.

## Review gate
Edits `eloup-web/`, so needs an independent review report in
`Agents/Review-reports/` by a **different** agent than `## Author:`, referencing
`ux1-primitives.md`, before implementation.
