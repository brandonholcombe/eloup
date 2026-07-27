# Review report — UX2 Screen redesign (Phase 2)

## Reviewer: claude-opus-4.8-ux2-reviewer

Reviews `Agents/TODO/Active/ux2-screens.md` (Author: `claude-opus-4.8-ux2-implementer`).
Verified against `eloup-web/` at HEAD on 2026-07-26.

## Verdict: Approve-with-changes

The plan is well-grounded, correctly scoped (presentation-only, no schema/auth/rating
touch), and every screen it names exists and matches the described current state. The
verification loop and test-watch callouts are sound. But three sub-parts describe work as
"markup swaps" when they actually require a prerequisite (Card Slot support), a new data
path (leaderboard rank query + `auth()`), and new client reactivity (1v1 auto-seed). These
are fixable within the plan; none are fatal. Sizing is too large for one cycle — implement
and re-review 2a–2d as separate commits/reviews as the doc already anticipates (§Review gate).

Counts: **1 Blocking, 5 Should-fix, 4 Optional.**

---

## Findings

### BLOCKING

**B1 — `<Card asChild>` is not executable yet; `card.tsx` has no Slot support.**
`components/ui/card.tsx:9-20` — `Card` is a plain `forwardRef` `<div>`. There is no
`asChild` prop and no `@radix-ui/react-slot` import. The 2a instruction "convert the
tokenized `<li>`/`<Link>`/`<section>` card rows to `<Card asChild>` (Slot preserves the
host element)" cannot run as written — `<Card asChild>` would just spread an unknown
`asChild` attribute onto a `div` and still render a `div`, silently wrapping (not
replacing) the `<li>`/`<Link>`.

The prerequisite is a one-line-ish edit mirroring `button.tsx:42-52`, which already does it
correctly: add `asChild?: boolean` to the props, `const Comp = asChild ? Slot : 'div'`, and
`@radix-ui/react-slot` is already a dependency (imported in `button.tsx:2`). The Slot
mechanism the doc relies on IS valid once added: `<Card asChild><li className="…">…</li>`
merges Card's `rounded-md border border-border bg-card …` onto the `<li>` (Radix Slot
concatenates `className` and merges props onto its single child), so the element stays an
`<li>` inside its `<ul>`/`<ol>` and keeps semantics. Same for `<Card asChild><Link>` — the
classes land on the anchor. **Fix:** add "Add `asChild`/Slot to `card.tsx`" as the first
step of 2a, before any row conversion. Also loosen the ref type (`HTMLDivElement` →
`HTMLElement`) or accept that the ref is nominal when the child isn't a div.

### SHOULD-FIX

**S1 — "Your rank" affordance (2c) is not markup-only; leaderboards has no session or rank
query.** `app/leaderboards/page.tsx:1-24` never calls `auth()` and fetches
`overallLeaderboard(handle, 50)` / `leaderboardForGame(handle, g.id, 50)` — a top-50 slice
with no notion of the viewer or of a player's absolute position. Surfacing "your position
when not in the visible top-N" requires (a) adding `auth()` (page is already
`force-dynamic`, so that's cheap) and (b) a new rank query in `lib/db/queries.ts`
(`RANK() OVER (...)` or a count-of-higher-ratings). The doc lists this as a bullet under
"Stat & ranking polish" as if it were a rendering tweak. Call out the query + auth work
explicitly, or move it to its own small task.

**S2 — 1v1 auto-seed needs a distinct opponent and format-change reactivity.**
`components/NewMatchForm.tsx:51` seeds exactly one row `[{ playerId: viewerId, placement: 1,
teamLabel: 'A' }]` — confirmed, so the auto-seed-two-rows improvement is real and correctly
located. Two logic risks the doc doesn't address:
  1. `eligiblePlayers[0]` (the "add participant" default at line 181) can be the viewer, so
     a naive second-row seed produces two rows with the same `playerId`. The seed must pick
     the first eligible player whose id ≠ `viewerId`, and degrade gracefully when the pool
     has only the viewer (tournament with one member).
  2. `rows` is only re-seeded on **tournament** change (`setRows(...)` at line 95) — never
     on **game/format** change (`setGameId` at line 113 does not reset rows). So switching
     to a 1v1 game will not trigger the two-row seed unless the plan adds a `useEffect`/
     derivation keyed on `game.format`. Note this is client state, so an effect that
     re-seeds on format transition (guarding against clobbering user edits) is the shape
     needed.
The `<input type="number">` at lines 143-149 has `min={1}` but no `inputMode`/`enterKeyHint`
/`max`/`<1` reject — so the numeric-input improvement is real and correctly located.

**S3 — The `text-slate-500` sweep must be selective, not blanket find/replace.** 50
occurrences across app+components (grep). Flipping `--muted-foreground`
(`app/globals.css:25`, currently `215 16% 47%` = slate-500) to slate-400 AND rewriting
`text-slate-500`→`text-muted-foreground` will over-brighten text that is intentionally dim:
  - `app/racing/[raceId]/page.tsx:289` — `faded ? 'text-slate-500' : ''` is the *dimmed*
    treatment for outlier/dropped rows; brightening it collapses the contrast against
    normal rows that gives the "faded" state its meaning. Leave this one alone.
  - `app/profile/page.tsx:104` uses `text-slate-600` (dimmer) for the category sub-heading,
    intentionally a notch below the slate-500 section labels. The sweep touches slate-500
    only, so the relative hierarchy holds — but if the implementer "rounds up" slate-600 to
    match, that hierarchy is lost. Keep slate-600 as-is.
  - Divider dots (`app/racing/page.tsx:86-92`, `[raceId]:222-224`) brightening is harmless
    to desirable. The doc's own caveat ("verify no text that was intentionally dim gets
    over-brightened") is correct; this finding just names the concrete traps.

**S4 — Confirm the button inventory before committing to "26".** `grep -c '<button'` returns
**28** raw `<button>` occurrences across 16 files (not 26). The delta is small and likely
the LapChart/CompareDrivers toggle chips the doc excludes, but the count should be re-taken
after excluding chips so the 2a checklist is exact. The `warning` (amber) variant is the
right home for the admin action — but note the current button is `bg-amber-600`
(`components/AdminForceConfirmButton.tsx:39`), i.e. Tailwind **amber**, not "orange" as the
doc says; make the new `--warning` token amber-600 to stay pixel-stable. No button resists
variant mapping: blue-500→`default`, slate-800→`secondary`, red→`destructive`, amber→new
`warning`. Preserve `h-tap min-w-tap` (the 44px pins) since `buttonVariants` `size` defaults
to `h-9` (36px) — a naive `<Button>` swap would shrink tap targets; the plan must pass
explicit height classes or add an `h-tap` size.

**S5 — Split 2a–2d into separate implement+review cycles.** Four sub-parts spanning a token
flip, two new primitive capabilities (Card Slot, `warning` variant), a client-form rewrite,
a new DB query, a sticky client island, and a list regroup is too much to land or review as
one unit. The doc's §Review gate already permits this; make it the explicit plan: 2a first
(it introduces the Card/Button capabilities 2b/2c reuse), then 2b/2c can interleave, 2d last
(and droppable). 2a should precede the others because the Card/Button adoption is the shared
foundation — but the contrast token flip (S3) can ship independently of Card adoption within
2a, so consider two commits inside 2a too.

### OPTIONAL

**O1 — Sticky confirm bar (2b) is feasible without breaking the server/client split.**
`app/matches/[id]/page.tsx:29` is a server component that already computes the per-row
`isMine && !confirmed && match.status === 'pending'` condition (lines 67, 93) and delegates
the action to the `ConfirmRowButton` client island (`components/ConfirmRowButton.tsx`). A
sticky bar is just a second client island rendered from the server component with the same
`matchId` + an `unconfirmed` flag; "below the fold" detection (IntersectionObserver on the
inline button) lives entirely in that client island. No blocker. Use `--safe-bottom`
(`app/globals.css:6`) for the bottom inset so it clears the iOS home indicator, and share
the POST logic with `ConfirmRowButton` to avoid divergence.

**O2 — "1 games" pluralization bug is real and there are two sites.** `app/profile/page.tsx:87`
renders `{c.gameCount} games · {c.totalMatches} matches` unconditionally, and line 116 uses
the `{r.gamesPlayed}g` short form (already safe). Fix both `games` and `matches` in the
By-category line, not just the one the doc names.

**O3 — `role="alert"` targets (2b a11y) are confirmed.** Error `<p>`s live at
`NewMatchForm.tsx:205`, `ConfirmRowButton.tsx:34`, `AdminForceConfirmButton.tsx` (err
block). All are `text-red-400`; adding `role="alert"` is safe and correctly located.

**O4 — No test asserts the markup the sweep/adoption touches; the doc's test-watch is
appropriately narrow.** `tests/unit/lap-chart-visibility.test.ts` asserts `opacity-40`,
`border-dashed`, `touch-none`, and `<polyline>` counts on `LapChart` chips — which the doc
explicitly excludes from the Button rollout, so keeping chips as-is keeps this green.
`tests/unit/compare-drivers-section.test.ts` asserts `<table>` presence and driver names,
not slate classes. No test asserts `text-slate-500`, card `border-border`, or button
classes, so 2a is test-safe. The doc's warning to "keep chips excluded" is exactly right.

---

## Technical corrections to the doc text
- 2a Card bullet: add the "add `asChild`/Slot to `card.tsx`" prerequisite (B1).
- 2a Button bullet: "raw orange button" → amber-600; re-count buttons (28 raw, minus chips);
  note the `h-tap` size-preservation gotcha (S4).
- 2c "Your rank" bullet: note it needs `auth()` + a new rank query, not just markup (S1).
- 2b match-entry bullet: note opponent-distinctness and format-change re-seed (S2).

The plan is a solid, honest inventory of real problems; these changes tighten the parts that
under-state their engineering cost. Approve once B1 is folded in and the sub-parts are
sequenced per S5.
