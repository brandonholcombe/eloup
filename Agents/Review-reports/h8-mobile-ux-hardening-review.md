# Review — H8 Mobile UI/UX hardening

## Reviewer: claude-opus-4.8-h8-independent-reviewer

Independent review of `Agents/TODO/Active/h8-mobile-ux-hardening.md` (Author:
`claude-opus-4.8-h8-implementer`). Every claim below was checked against the
live source under `eloup-web/`, not the task doc's assertions.

## Verdict: Approve-with-changes

The two P0 fixes are correct and the diagnosis is accurate. Two of the three
P1 items describe a mechanism that is subtly wrong or self-contradictory and
must be corrected before implementation. Nothing is blocking; all findings are
addressable in the same change.

- Blocking: 0
- Should-fix: 3
- Optional: 4

---

## P0-1 — `h-tap` undefined — CONFIRMED, fix is correct

Verified `tailwind.config.ts:11-16` defines only `minHeight.tap` and
`minWidth.tap`; there is **no** `height.tap` key (`grep height tailwind.config.ts`
returns nothing). `h-tap` genuinely appears 61 times across 24 files
(bottom nav, `ConfirmRowButton.tsx:30`, `NewMatchForm.tsx`, form submits,
filter chips, `InstallHintIOS.tsx:52`, `InstallHintAndroid.tsx:44/54`, etc.).

- The proposed one-line fix `height: { tap: '44px' }` is the correct, minimal
  fix. `height.tap` is a **separate** Tailwind theme key from `minHeight.tap`
  and `minWidth.tap`, so there is **no collision**: `min-h-tap`
  (`app/profile/page.tsx:133`) and `min-w-tap` are unaffected. Good call
  keeping them as-is.
- No flex-stretch breakage risk in practice: the vast majority of `h-tap`
  usages are on `<input>/<select>/<button>` with `block w-full h-tap`
  (e.g. `NewMatchForm.tsx:97/114`, `NewGameForm.tsx`, `RaceAdminPanel.tsx`),
  where a fixed 44px height is exactly the intent.

**Should-fix (verification scope + risk framing):** The doc calls this
"additive/low-risk." It is the opposite of low-blast-radius — it changes the
rendered height of ~61 controls app-wide simultaneously. That is desirable,
but the verification section only spot-checks 3 components (BottomNav /
ConfirmRowButton / NewMatchForm submit). Please broaden the smoke check to
cover the **filter chips/pills** (`leaderboards/page.tsx:71`,
`TrackFilter.tsx:28`, `CompareDriversSection.tsx:112`, `LapChart.tsx:210` —
these use `rounded-full px-4 py-1.5` and will grow from ~32px to 44px pills)
and the **two-line flex-col nav items**, since those are where a forced 44px
could look off.

**Optional (nav clip):** `BottomNav.tsx:49` items are `flex h-tap flex-col`
with an icon (`text-lg`, ~28px line box) + label (`text-xs`, ~16px) + `gap-0.5`
≈ ~46px of content. Forcing `height:44px` with `justify-center` centers and
clips ~1-2px top/bottom. Negligible, but if it reads badly, use `min-h-tap`
here instead of `h-tap` (the nav is one of the few places where min-height,
not fixed height, is the better semantic).

## P0-2 — body `pb-24` clips behind nav — CONFIRMED, fix works

Verified `app/layout.tsx:26` (`...pb-24...`) and that `--safe-bottom` **is**
defined at `app/globals.css:6` (`--safe-bottom: env(safe-area-inset-bottom)`),
so the proposed `style={{ paddingBottom: 'calc(6rem + var(--safe-bottom,0px))' }}`
will resolve correctly.

- The reasoning in the doc ("~0px clearance") slightly overstates it — `pb-24`
  is 96px and already roughly equals nav content + inset — but the conclusion
  (the inset is not currently added, so clip is possible under larger content
  or larger insets) is right, and adding the inset is the correct fix.

**Optional (over-padding):** After P0-1, the nav is ~60px content + 16px
(`py-2`) + its own `--safe-bottom` padding ≈ 60px + inset. `calc(6rem + inset)`
= ~96px + inset over-pads the body by ~36px of blank space above the nav.
Harmless, and keeping `6rem` cleanly preserves the existing baseline, so this
is fine to ship — but if the extra gap looks loose, `calc(4rem + var(--safe-bottom))`
is closer to the true nav height. A Tailwind arbitrary value
(`pb-[calc(6rem+env(safe-area-inset-bottom))]`) is equally acceptable and keeps
it out of an inline style.

## P1-1 — active nav indicator — approach is right, mechanism is wrong

Confirmed `BottomNav.tsx:35` is `export async function BottomNav()` awaiting
`auth()`, so it cannot call `usePathname()`. Extracting the item list into a
`'use client'` child that calls `usePathname()` is the correct App Router
pattern, and the `startsWith` logic is sound here:

- The hrefs are `/leaderboards /racing /matches /tournaments /profile`
  (`BottomNav.tsx:9-13`) — **none is `/`**, so there is no "matches everything"
  bug. `/` itself `redirect()`s to `/leaderboards` (`app/page.tsx:4`), so the
  home route never renders an ambiguous state.
- `startsWith(item.href)` correctly lights the parent tab for sub-routes:
  `/racing/tracks/[slug]` → Racing, `/matches/[id]` → Matches,
  `/tournaments/[slug]` → Cups. That is the desired behavior, not an edge case.

**Should-fix (server action cannot move into the client boundary):** The plan
says "extract the `<ul>`… into a client child" and "pass `signedIn` as a prop."
But `SignInButton` (`BottomNav.tsx:16-33`) contains an **inline `'use server'`
server action**, and it is rendered as an `<li>` **inside the same `<ul>`** for
the `justify-around`/`flex-1` layout. A server action cannot be defined or
rendered inside a `'use client'` component. So the client child must **not**
own the sign-in `<li>` (passing only a `signedIn` boolean and having the child
render `SignInButton` will fail to compile). Correct pattern: the server parent
renders `<SignInButton/>` and passes it into the client child as a
`children`/slot prop (React composition), and the client child renders
`<ul>{navItemLinks}{children}</ul>`. Please make the plan explicit that
composition (children slot), not a boolean flag, is how the sign-in slot stays
server-side while remaining inside the flex `<ul>`.

**Note (tests):** No existing test asserts BottomNav markup —
`tests/unit/admin-nav-links.test.ts` only exercises `lib/permissions`
`adminNavLinks`, unrelated to this component. So P1-1 will not break existing
tests, and the plan's offer to add an active-class unit test is reasonable.

## P1-2 — back link — reconsider `router.back()`; plan is self-contradictory

Confirmed `app/matches/[id]/page.tsx` and `app/tournaments/[slug]/page.tsx`
render with no back affordance, and the existing racing pattern is a **plain
static server-rendered `<Link>`**, not `router.back()`:
`app/racing/[raceId]/page.tsx:211` →
`<Link href="/racing" className="text-sm text-slate-400 hover:text-slate-200">← All races</Link>`
(same at `racing/drivers/[driverId]/page.tsx:38`, `racing/tracks/[slug]/page.tsx:25`,
`racing/upload/page.tsx:42`).

**Should-fix:** Two problems with the proposed `router.back()` BackLink:

1. **Deep-link safety.** In a `display: standalone` PWA opened directly on
   `matches/[id]` (shared link, home-screen shortcut), `window.history.length`
   can be 1 and `router.back()` is a no-op — the exact dead-end this task is
   trying to remove. The plan mentions "a sensible labeled fallback href" but
   pairs it with `router.back()` without specifying the guard. If you keep
   `router.back()`, you **must** implement the guard (e.g. only `back()` when
   `window.history.length > 1`, else `router.push(fallback)`).
2. **Self-contradiction.** The plan says "match the visual style of the
   existing racing `← All races` links" **and** "the back link must be ≥44px."
   The racing links are **not** 44px — they are bare `text-sm` links with no
   `h-tap`/`min-h-tap`. You cannot both match them and be 44px. Resolve this:
   either accept the racing style as-is (drop the 44px requirement for
   back-links to stay consistent), or bump the racing links too (scope creep).

Recommendation: for `matches/[id]` and `tournaments/[slug]`, just use the same
**static `<Link href="/matches">← Matches</Link>` / `href="/tournaments"`**
pattern the racing pages already use. It needs no `'use client'` component, is
deterministic, has no history/standalone pitfall, and is genuinely consistent
with the rest of the app. The `router.back()` + shared `<BackLink>` component
is more machinery for a worse robustness profile.

## P1-3 — loading.tsx skeletons — CONFIRMED, minor route notes

Confirmed there are **zero** `loading.tsx` files under `app/`
(`find app -name loading.tsx` empty). All six listed routes
(`leaderboards`, `racing`, `racing/[raceId]`, `matches`, `tournaments`,
`profile`) are `export const dynamic = 'force-dynamic'` async server
components, so a `loading.tsx` Suspense boundary **will** trigger on
navigation. Approach is valid.

**Optional (loading inheritance):** A `loading.tsx` applies to its segment
**and all nested segments** until overridden. So `app/racing/loading.tsx` will
also show the racing-list skeleton when navigating to `/racing/tracks/[slug]`,
`/racing/drivers/[driverId]`, and `/racing/upload` (only `/racing/[raceId]`
gets its own override). Mild cosmetic mismatch; acceptable, but worth a
conscious decision.

**Optional (missing where it matters most):** The two deep detail pages this
same task adds back-links to — `matches/[id]` and `tournaments/[slug]` — are
also `force-dynamic` and do heavy DB reads, yet get **no** skeleton. Those are
arguably the highest-value loading states (slow single-record reads after a
tap). Consider including them.

---

## Summary of required changes

- **Should-fix:** P1-1 — the sign-in slot (which holds a `'use server'` action
  and must sit inside the `<ul>`) has to be passed to the client child as a
  children/slot prop, not rendered from a `signedIn` boolean inside the client
  boundary.
- **Should-fix:** P1-2 — prefer a static `<Link>` matching the existing racing
  pattern; if `router.back()` is kept, implement the history-length fallback
  guard, and resolve the "match racing style" vs "≥44px" contradiction.
- **Should-fix:** P0-1 — reframe as an app-wide visual change and widen the
  verification pass beyond three components to include chips/pills and the
  two-line nav items.
- **Optional:** P0-2 over-padding, `loading.tsx` inheritance on racing
  subroutes, add loading to `matches/[id]`/`tournaments/[slug]`, nav flex-col
  clip.

The core diagnoses are accurate and the P0 fixes are exactly right. Address the
three should-fix items (mostly plan-clarification, not redesign) and this is
good to implement.
