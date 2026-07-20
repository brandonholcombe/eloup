# Review — UX1 Component primitives (Card/Badge/Skeleton + Button + Lucide nav)

## Reviewer: claude-opus-4.8-ux1-reviewer

Reviews `ux1-primitives.md` (Author: `claude-opus-4.8-ux1-implementer`), Phase 1 of
`ux-overhaul-plan.md`. Verified against the live tree at
`/Users/brandonholcombe/kodloki/eloup/eloup-web/`, not the doc's assertions.

## Verdict: Request-changes

The approach (route cards/buttons/skeleton/nav through shared primitives themed to
the current look) is sound, the token groundwork from Phase 0 is correct, and most
claims check out. But the doc's central instruction — "replace `rounded-md border
border-slate-800 bg-slate-900` (21 occurrences) with `<Card>`" — is inaccurate as a
literal recipe: at least 2 of those 21 sites are on non-`<div>` host elements (`<svg>`,
`<details>`) that a `<Card>` (renders a `div`) would break functionally, and the doc's
named file list includes two components (`TournamentStandings`, `RaceAdminPanel`) that
do not contain the exact string at all. These need explicit carve-outs before
implementation. The fixes are bounded (exclusion list + a scope split), not a redesign.

Blocking: 2 · Should-fix: 4 · Optional/confirmations: 4

---

## Blocking

### B1 — Card sweep targets non-`<div>` elements that break on a `<Card>` swap
The exact string is present on host elements that cannot become a `Card` div:

- `components/LapChart.tsx:105` — the string is on the chart `<svg>` element
  (`className="block w-full rounded-md border border-slate-800 bg-slate-900"`).
  `Card` renders a `div`; you cannot nest chart geometry in a div, and swapping the
  `<svg>` itself is impossible. Must be excluded.
- `app/racing/[raceId]/page.tsx:261` — the string is on a native `<details>`
  disclosure (`<details ... className="rounded-md border border-slate-800
  bg-slate-900"><summary>…`). A `<Card>` (div) removes the native expand/collapse.
  Must be excluded, or restyle the `<details>` in place (Card cannot host `<summary>`
  semantics without `asChild`, which forwards to the child element type — not
  applicable to `<details>` here).

The doc's verification section promises every swept surface is "pixel-identical"; these
two would be functional breakage, not a pixel diff. The "21 occurrences → `<Card>`"
framing must be corrected to an explicit include/exclude list before implementation.

---

## Should-fix

### S1 — Two more of the 21 are not plain cards; realistic clean-swap count is ~16–17
- `components/LapChart.tsx:66` — string is on a `<p>` empty-state ("No lap data for
  this race."). Swapping to `Card` (div) changes the element/semantics of a text
  message. Prefer leaving as `<p>` or wrapping deliberately.
- `app/profile/page.tsx:133` — string is on an interactive `<Link>` with
  `hover:bg-slate-800` + `focus-visible:outline` states (an admin-link row). A naive
  `<Card>` swap drops the anchor; would need `<Card asChild><Link>…</Link></Card>` or
  keeping the `Link` and only tokenizing classes. Doc says "keep each element's extra
  classes via className" but does not address host-element changes.

Net: of the 21 exact matches, ~4 (`LapChart:66/105`, `racing/[raceId]:261`,
`profile:133`) are not straightforward div cards, and `components/Skeleton.tsx:14` is
the skeleton row template (being rebuilt in step 4 anyway, not a real "card" site).
The doc should state the true clean-swap set (~16) rather than "21 → Card".

### S2 — Named card targets `TournamentStandings` and `RaceAdminPanel` do NOT contain the exact string
The doc lists these under "the 21 duplicates," but neither matches the exact-string
sweep, and both are near-miss variants the single exact target will silently MISS —
leaving them inconsistent with the new Card (defeating the "one source of truth" goal):

- `components/TournamentStandings.tsx:21-24` — conditional card class
  `'flex items-center gap-3 rounded-md border px-3 py-2 '` + active
  `'border-blue-500 bg-slate-900'` vs default `'border-slate-800 bg-slate-900'`. An
  active/selected border variant the exact string can't express.
- `components/RaceAdminPanel.tsx:42` — `rounded-md border border-slate-700
  bg-slate-900/60` (`<details>`), and `:54,:62` — `rounded border border-slate-800
  bg-slate-900/40` (note `rounded`, not `rounded-md`, and `/40` opacity).

Either broaden the sweep to cover these near-misses (with a documented mapping to Card
variants) or drop them from the named list so the doc doesn't overstate coverage.
Other near-misses confirmed present but correctly out of scope: `InfoTip.tsx:48`
tooltip (`bg-slate-950`), and the many form-input `border-slate-700 bg-slate-900`
`<input>/<select>/<textarea>` lines (not cards).

### S3 — Toggle chips don't map to any Button variant, and a test asserts their classes
The doc says "Replace remaining inline `<button>` … app-wide with `<Button>`" with no
carve-out, but two are `rounded-full` toggle chips with custom active/inactive styling
that maps to no shadcn variant:

- `components/LapChart.tsx` chip — `inline-flex h-tap min-w-tap … rounded-full border
  …` with visible/hidden states (`border-dashed … opacity-40`).
- `components/CompareDriversSection.tsx:102` — `rounded-full border …` with
  `aria-pressed`, active `border-blue-400 bg-blue-500/20 text-blue-100`.

Additionally `tests/unit/lap-chart-visibility.test.ts:60-70` asserts
`toContain('opacity-40')` and `toContain('border-dashed')` on rendered LapChart markup.
A Button swap that drops those classes breaks the test — so the doc's blanket "current
tests are swap-safe … assert text/structure, not button/card classes" is not fully
accurate here. Recommend explicitly excluding both chips from the Button rollout (they
are toggles, not buttons; a `Toggle` primitive is a Phase-2 concern).

### S4 — Split Phase 1; and button "visually stable" claim is slightly overstated
Scope is large for one review: 3 new primitives + 21 card sites across 16 files + 28
inline `<button>` across 16 files + skeleton rebuild + nav — ~30 files, ~50 edit sites.
The button rollout carries nearly all the judgment (chip exclusions, variant mapping,
class-asserting tests, 44px pins, `use server`/`disabled`/`aria` preservation). Suggest
the split the plan itself hints at: **1a** = primitives + card sweep + skeleton;
**1b** = button rollout + chip decisions + Lucide nav. Smaller, independently
verifiable diffs.

On visual stability: the base color is fine — `--primary: 217 91% 60%` (blue-500,
`app/globals.css:20`) matches the current `bg-blue-500` submits, so `default` variant
color is stable. But the shadcn `default` variant adds `shadow` and uses
`hover:bg-primary/90` (darker/translucent), whereas current submits are shadow-less with
`hover:bg-blue-400` (lighter). So swept buttons gain a subtle shadow and a different
hover tint — a real, if small, visual change the "everything else stays visually
stable" claim glosses over. Either strip `shadow` / realign hover in the sweep, or
call it out as an accepted minor change.

---

## Optional / confirmations (verified, no action or minor)

### C1 — lucide-react 1.25.0 is AUTHENTIC, not a typosquat
`package.json:24` pins `^1.25.0`; installed `node_modules/lucide-react/package.json`
reports the genuine package: author "Eric Fennis", repo `lucide-icons/lucide`, homepage
`lucide.dev`, ISC license, `sideEffects: false`, devDeps on `@lucide/build-icons`. The
lockfile carries an integrity hash (`sha512-/mdJTRbiwcLOQ1…`). Real icon exports present
in the type defs: Trophy, Car, Flag, Dices, Medal, User, LogIn, KeyRound — every icon
the doc names exists. The "real lucide-react is ~0.4xx, not 1.x" premise is pre-2026
knowledge; lucide-react went 1.x after the Jan-2026 cutoff. No supply-chain concern —
the doc's "already installed" claim is correct.

### C2 — Skeleton rebuild is safe
`components/Skeleton.tsx` exports `SkeletonBar`, `SkeletonRows`, `PageSkeleton`
(lines 4/8/25). All 8 `loading.tsx` files import **only** `PageSkeleton` (racing,
racing/[raceId], matches, matches/[id], profile, tournaments, tournaments/[slug],
leaderboards). Rebuilding `SkeletonBar` on `ui/skeleton` is safe as long as
`SkeletonRows`/`PageSkeleton` signatures are preserved — the loading files never import
`SkeletonBar` directly. Note `--muted: 217 33% 17%` = slate-800 (`globals.css:24`), so
`bg-muted` and `bg-slate-800` are identical; either fill works.

### C3 — Nav swap logic is safe; two small notes
`components/BottomNavItems.tsx:10` types `icon: string`, rendered at line 43 as
`{it.icon}` inside `<span aria-hidden className="text-lg">`. Active color comes from the
`<Link>` (`text-white` vs `text-slate-300`), which Lucide inherits via `currentColor` —
the active-tab highlight survives. `tests/unit/nav-active.test.ts` only exercises the
pure `isNavItemActive` function (no render, no icon assertion), so it survives the swap;
no test asserts on the emoji glyphs. Two notes: (a) both `BottomNavItems.tsx` (type +
`{it.icon}` → `<it.icon/>`) and `BottomNav.tsx:6-10` (the emoji items array) must change
together; (b) the wrapper's `text-lg` sizes a glyph but not an SVG — the Lucide icons
need an explicit `size`/`className` (doc says ~20–24px), else they render at the default
24px, fine, but don't rely on `text-lg`.

### C4 — CardContent p-6 padding trap: adequately handled, keep it explicit
shadcn `CardContent` defaults to `p-6`; the app rows are `p-3` / `px-3 py-2` / `p-4`.
The doc's plan ("expose the subcomponents; callers pick" and pixel-diff each surface)
means rows should be `<Card className="px-3 py-2">` with content inline, NOT wrapped in
a default `<CardContent>`. That's correct — just make it explicit in the implementation
that row cards must not adopt the default `CardContent` padding, or cards get fatter.
Also retheme the generated `card.tsx` to `rounded-md` + no `shadow` (new-york default is
`rounded-xl … shadow`); the doc states this correctly and it is necessary and
sufficient given `--card`=slate-900 / `--border`=slate-800.

---

## Bottom line
Fold in an explicit **card-sweep include/exclude list** (exclude `LapChart.tsx:66,105`,
`racing/[raceId]/page.tsx:261`; special-case `profile/page.tsx:133`), correct the
`TournamentStandings`/`RaceAdminPanel` near-miss claims, **exclude the LapChart and
CompareDrivers toggle chips** from the Button rollout (and note the LapChart class
assertion in the test), acknowledge the button shadow/hover shift, and preferably
**split 1a/1b**. With those, the plan is safe to implement.
