# H8 — Mobile UI/UX hardening: tap targets, safe-area, active nav, back links, loading states

## Author: claude-opus-4.8-h8-implementer
## Status: Complete

## Implementation outcome (2026-07-19)

All P0 + P1 scope implemented; reviewer should-fix corrections applied.

- **P0-1:** added `height: { tap: '44px' }` to `tailwind.config.ts`.
  Verified in the built CSS: `.h-tap{height:44px}` is now emitted
  (previously absent), so all 61 `h-tap` usages render at 44px;
  `.min-h-tap`/`.min-w-tap` unchanged.
- **P0-2:** `app/layout.tsx` body now
  `pb-[calc(6rem+env(safe-area-inset-bottom))]`; verified compiled to
  `padding-bottom:calc(6rem + env(safe-area-inset-bottom))`.
- **P1-1:** split `BottomNav` into the server parent (keeps `auth()` +
  the `'use server'` sign-in action) and a new client
  `components/BottomNavItems.tsx` using `usePathname()`; sign-in slot
  passed via **composition** (children), not a boolean. Active tab gets
  `bg-slate-800 font-medium text-white` + `aria-current="page"`. Nav
  items use `min-h-tap` (better semantic than fixed height for the
  two-line stack, per reviewer optional note). Active-route logic
  extracted to `lib/nav.ts` (`isNavItemActive`) with a 4-case unit test
  (`tests/unit/nav-active.test.ts`), incl. the `/matches-archive`
  false-prefix guard.
- **P1-2:** static `<Link>` back-affordance added to `matches/[id]`
  (`← Matches`) and `tournaments/[slug]` (`← Tournaments`), matching the
  existing racing `← All races` pattern exactly. No `router.back()`, no
  client component — deterministic and standalone-PWA safe.
- **P1-3:** `loading.tsx` skeletons added for all 8 routes
  (leaderboards, racing, racing/[raceId], matches, matches/[id],
  tournaments, tournaments/[slug], profile) via shared
  `components/Skeleton.tsx`. Racing subroute inheritance accepted as a
  conscious tradeoff (documented above).

**Gates:** `pnpm lint` clean · `pnpm typecheck` exit 0 · `pnpm build`
clean (First Load JS 100–114kB, under the 150KB budget) · `pnpm test`
**308 passing** (304 → 308, +4 nav-active). No symbol/property changed,
so no `manifest.json`/lock update needed.

**Not done (deferred to `h9-mobile-ux-polish.md`):** match-entry
ergonomics, sticky confirm bar, list-row `min-h-tap`, table overflow
wrappers, `role="alert"` on errors, contrast/tiny-text, SW offline
fallback + version hash + iPad hint detection.

## Reviewer findings folded (2026-07-19)

Independent review at `Agents/Review-reports/h8-mobile-ux-hardening-review.md`
(Reviewer: `claude-opus-4.8-h8-independent-reviewer`) returned
**Approve-with-changes** — 0 blocking, 3 should-fix, 4 optional. Both P0
diagnoses were verified accurate. The three should-fix corrections are folded
into the scope sections below:
- **P0-1** reframed as an app-wide visual change with a widened verification
  pass (chips/pills + two-line nav items), plus the optional nav-clip note.
- **P1-1** mechanism corrected: the sign-in slot holds a `'use server'` action
  and CANNOT be rendered from a `signedIn` boolean inside a client boundary —
  it must be passed to the client child as a `children`/slot prop (composition).
- **P1-2** mechanism corrected: drop `router.back()` (no-op on a deep-linked
  standalone PWA) and the self-contradictory 44px requirement; use the same
  static `<Link>` pattern the racing pages already use.
- Optional items (P0-2 padding tightness, loading.tsx inheritance, loading on
  the two detail pages) folded as noted inline.

## Motivation

A three-part mobile UI/UX review (2026-07-19) of `eloup-web` found the
mobile foundation solid (bottom nav, safe-area insets, `viewportFit:
cover`, PWA manifest with maskable icons, native `<select>` pickers,
empty states, responsive touch chart) but surfaced one config bug that
silently defeats the tap-target system app-wide, plus a set of
"doesn't-feel-like-a-real-installed-app" gaps. This task fixes the P0
(critical, one-line, app-wide) and P1 (core UX defect) findings. P2
polish (match-entry ergonomics, sticky confirm bar, table overflow,
contrast) is intentionally deferred to a follow-up task.

All changes are additive/low-risk. No schema, auth, rating, or
deployment symbols change, so no `symbols/manifest.json` update is
expected. If any tracked property is touched, re-run `python
scripts/align.py lock` in the same commit.

## Scope — P0 (critical)

### P0-1. `h-tap` is undefined → most 44px tap targets never render at 44px
`tailwind.config.ts` defines `minHeight.tap` and `minWidth.tap` (→
`min-h-tap`, `min-w-tap`) but **not** `height.tap`. The class `h-tap` is
used **61 times across 24 files** (bottom nav, confirm buttons, all form
submit buttons, filter chips, install hints) and compiles to no CSS, so
those controls fall back to padding-only height (~28–36px), under the
44px minimum.

- **Fix:** add `height: { tap: '44px' }` to `theme.extend` in
  `tailwind.config.ts`. This is the single highest-ROI change — it
  restores 44px height to all 61 usages at once.
- **Do NOT** mass-rewrite `h-tap` → `min-h-tap`; the one-line config
  add is the correct, minimal fix. (Keep `min-h-tap`/`min-w-tap` as-is.)
- **Risk (reviewer):** this is NOT low-blast-radius — it changes the
  rendered height of ~61 controls app-wide at once. Desirable, but must
  be smoke-checked broadly, not on 3 components.
- **Verify (widened):** after the config change, confirm ≥44px height on
  (a) `BottomNav` items, `ConfirmRowButton`, `NewMatchForm` submit;
  (b) the `rounded-full px-4 py-1.5` **filter chips/pills** that grow
  ~32px→44px — `leaderboards/page.tsx:71`, `TrackFilter.tsx:28`,
  `CompareDriversSection.tsx:112`, `LapChart.tsx:210`; and (c) the
  **two-line flex-col nav items** where a forced height could clip.
- **Optional (nav clip):** `BottomNav.tsx:49` items are `flex h-tap
  flex-col` with icon (~28px) + label (~16px) + `gap-0.5` ≈ 46px of
  content; forcing `height:44px` centers-and-clips ~1–2px. If it reads
  badly, switch the **nav items only** to `min-h-tap` (min-height is the
  better semantic for the nav) — the config `height.tap` fix still
  stands for the other ~60 usages.

### P0-2. Body `pb-24` clips content behind the nav on home-indicator devices
`app/layout.tsx:26` uses a fixed `pb-24` (96px) that does not include
the bottom safe-area inset. Nav height (~62px) + inset (~34px) ≈ 96px
leaves ~0px clearance; the last content row can sit flush against / be
clipped by the nav on notched iPhones.

- **Fix:** make the body bottom padding track the inset. Preferred form
  is a Tailwind arbitrary value to avoid an inline style:
  `pb-[calc(6rem+env(safe-area-inset-bottom))]` (drops the fixed
  `pb-24`). An inline `style={{ paddingBottom: 'calc(6rem +
  var(--safe-bottom, 0px))' }}` is equivalent (`--safe-bottom` is
  defined in `globals.css:6`).
- **Optional (reviewer, tightness):** `6rem` (96px) slightly over-pads —
  the real nav is ~60px content + `py-2` + its own inset ≈ closer to
  4rem + inset. Keeping `6rem` preserves the existing baseline and is
  fine to ship; use `calc(4rem+env(safe-area-inset-bottom))` only if the
  gap above the nav looks loose in the smoke test.

## Scope — P1 (core defects)

### P1-1. Bottom nav has no active-route indication
`components/BottomNav.tsx` is an `async` server component (awaits
`auth()`), so it can't call `usePathname()`; every tab renders the
identical class string. No visual "you are here."

- **Fix:** extract the `<ul>` of nav items into a small `'use client'`
  child (e.g. `BottomNavItems`) that calls `usePathname()` and applies
  an active treatment (`text-white` + top border or filled pill) plus
  `aria-current="page"` when `pathname.startsWith(item.href)`.
- **Corrected mechanism (reviewer, should-fix):** the sign-in slot
  (`SignInButton`, `BottomNav.tsx:16-33`) contains an inline
  `'use server'` action and is an `<li>` **inside** the same `<ul>` for
  the `justify-around`/`flex-1` layout. A server action cannot be
  defined or rendered inside a `'use client'` boundary, so the client
  child must **NOT** own the sign-in `<li>` and a `signedIn` boolean
  flag will NOT compile. Use React **composition**: the server parent
  renders `<SignInButton/>` and passes it into the client child as a
  `children`/slot prop; the client child renders
  `<ul>{navItemLinks}{children}</ul>`. This keeps the action
  server-side while the sign-in item stays inside the flex `<ul>`.
- **`startsWith` is safe here (verified):** hrefs are
  `/leaderboards /racing /matches /tournaments /profile` — none is `/`,
  so no "matches everything" bug; `/` `redirect()`s to `/leaderboards`.
  `startsWith` correctly lights the parent tab for sub-routes
  (`/racing/tracks/[slug]` → Racing, etc.).
- **Tests:** no existing test asserts BottomNav markup
  (`tests/unit/admin-nav-links.test.ts` only exercises
  `lib/permissions`), so this won't break the suite; adding a small
  active-class unit test is reasonable. Preserve 44px targets (post
  P0-1) and safe-area padding.

### P1-2. Deep detail pages have no in-app back affordance
`app/matches/[id]/page.tsx` and `app/tournaments/[slug]/page.tsx` render
straight into the content with no back link. In a `display: standalone`
PWA there is no browser back button, so these are partial dead-ends
(only escape is a top-level nav tab, losing context). Racing detail
pages already have `← All races`.

- **Corrected mechanism (reviewer, should-fix):** do **NOT** use
  `router.back()` — on a deep-linked standalone PWA (shared link /
  home-screen shortcut) `window.history.length` is 1 and `back()` is a
  no-op, i.e. the exact dead-end this task removes. Also drop the
  self-contradictory "≥44px" requirement: the existing racing links are
  bare `text-sm` links with no tap sizing, so "match racing style" and
  "be 44px" cannot both hold.
- **Fix (final):** add a plain static server-rendered `<Link>` matching
  the racing pattern exactly — `app/racing/[raceId]/page.tsx:211` uses
  `<Link href="/racing" className="text-sm text-slate-400
  hover:text-slate-200">← All races</Link>`. So:
  - `matches/[id]` → `<Link href="/matches">← Matches</Link>`
  - `tournaments/[slug]` → `<Link href="/tournaments">← Tournaments</Link>`
  No `'use client'`, no history/standalone pitfall, deterministic, and
  genuinely consistent with the rest of the app. No shared `<BackLink>`
  component needed.

### P1-3. No loading states — screens freeze on the old page during fetches
There are zero `loading.tsx` files in `app/`; every page is
`force-dynamic` with synchronous server-side DB reads, so navigation
shows no feedback until the server responds.

- **Fix:** add `loading.tsx` skeleton files for the primary routes:
  `app/leaderboards/`, `app/racing/`, `app/racing/[raceId]/`,
  `app/matches/`, `app/tournaments/`, `app/profile/`. Keep skeletons
  lightweight (shell + shimmer rows), matching the dark slate theme and
  the `max-w-md` container. This is a perceived-performance win.
- **Fold (reviewer, optional → adopt):** also add `loading.tsx` to the
  two deep detail routes this task touches — `app/matches/[id]/` and
  `app/tournaments/[slug]/` — they are `force-dynamic` single-record DB
  reads after a tap, the highest-value loading states.
- **Note (reviewer, inheritance):** a `loading.tsx` cascades to nested
  segments until overridden, so `app/racing/loading.tsx` will also show
  for `/racing/tracks/[slug]`, `/racing/drivers/[driverId]`, and
  `/racing/upload` (only `/racing/[raceId]` overrides it). This is an
  accepted, conscious tradeoff — a generic racing skeleton is fine for
  those subroutes; do not add per-subroute skeletons in H8.

## Out of scope (deferred to a P2 follow-up task)

- Match-entry ergonomics: 1v1 auto-seed, one-tap winner toggle,
  `inputMode="numeric"` + placement clamping on `NewMatchForm`.
- Sticky bottom confirm bar on `matches/[id]`.
- `min-h-tap` on `matches` list rows (currently `px-3 py-2` ≈ 36px).
- `overflow-x-auto` wrappers on the race-standings and compare tables.
- a11y: `role="alert"` on error `<p>`s; focus management on submit fail.
- Contrast: `text-slate-500` → `slate-400`; floor 9–11px text to ~12px.
- Service worker: dedicated `/offline` fallback page, build-hash cache
  versioning, iPad (`maxTouchPoints`) install-hint detection.

These are catalogued in the review and should become
`h9-mobile-ux-polish.md` after H8 lands.

## Testing / verification

- `pnpm lint`, `pnpm typecheck`, `pnpm build` all clean.
- `pnpm test` (vitest) stays green; add/adjust tests only where a
  component gains testable logic (e.g. active-tab class selection).
- Manual or Playwright check at a ~390px viewport: bottom-nav items and
  confirm/submit buttons measure ≥44px; active tab is visually distinct
  with `aria-current="page"`; a match detail and a tournament detail
  each have a working back control; last content row is not clipped by
  the nav on a simulated notched device; the six routes show a skeleton
  on slow navigation.
- `python scripts/align.py check` → OK (expected: no symbol change).

## Review gate

This task edits `eloup-web/` source, so per CLAUDE.md it requires an
independent review report in `Agents/Review-reports/` authored by a
**different** agent than `## Author:` above, referencing
`h8-mobile-ux-hardening.md`, before implementation. Flip this doc to
`## Status: In Progress` when starting and `## Status: Complete` when
done.
