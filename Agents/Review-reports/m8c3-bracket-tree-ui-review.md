# Review — M8c.3 Bracket tree UI (visual pyramid + flow)

## Reviewer: claude-opus-4.8-m8c3-reviewer

Reviews task `m8c3-bracket-tree-ui.md` (Author: `claude-opus-4.8-m8c3-implementer`).
Scope reviewed: the layout-positioning approach, connector correctness, reporting
preservation, mobile feasibility, and server/client split. Verified against the
shipped engine (`lib/bracket/engine.ts`), the current `components/Bracket.tsx` +
`components/ReportBracketNode.tsx`, `app/tournaments/[slug]/page.tsx`, and the
inline-SVG precedent `components/LapChart.tsx`. Engine, data model, persistence,
and the report/shuffle flow are unchanged and I did not review them beyond
confirming the shape the layout consumes.

## Verdict: Approve-with-changes

The core approach — pure `layoutBracket(nodes)` → absolutely-positioned cards +
an inline-SVG connector layer, rendered server-side with client `ReportBracketNode`
islands — is right for this codebase and matches the LapChart precedent. The
bottom-up midpoint rule DOES produce a non-overlapping, readable pyramid for both
the winners tree and the losers band, contrary to the task's stated worry — BUT
only under a precise definition of "feeder" that the doc leaves underspecified.
Two items must be nailed down before/during implementation (both Blocking), plus
a few should-fix items. This is a visual/iterative task; screenshot validation is
the right acceptance gate once the two Blocking clarifications are in.

---

## Findings

### Blocking

**B1 — Define LB node y as the average of SAME-BAND (losers) feeders only; the WB
drop must never constrain y.** This is the crux the task flags. I traced a 16-draw
LB concretely (LR1:4, LR2:4, LR3:2, LR4:2, LR5:1, LR6:1). The losers bracket is
NOT a clean binary tree — it alternates:

- Minor→major (LR1→LR2, LR3→LR4, LR5→LR6): 1:1 same position. The major node has
  exactly **one** LB feeder (slot1) plus a **WB dropper** (slot2, from a different
  band).
- Minor merges (LR2→LR3, LR4→LR5): 2:1, two LB feeders.

The midpoint rule works **iff** you compute each LB node's y as the mean of the
LB nodes whose `winnerTo.id === node.id` (filter `bracket === 'losers'`), treating
a 1-feeder major node as *inheriting* its single feeder's y and a 2-feeder merge
node as the true midpoint. Traced result (in ROW units): LR1 = 0.5/1.5/2.5/3.5;
LR2 inherits 0.5/1.5/2.5/3.5; LR3 = 1.0/3.0; LR4 inherits 1.0/3.0; LR5 = 2.0; LR6
inherits 2.0. No two nodes in a round collide; the band forms a clean pyramid.

The failure mode the doc risks: an implementer reads "midpoint of its two feeders"
and computes the mean of slot1/slot2 entrants, which on a major round pulls in the
**WB dropper sitting up in the winners band** — yanking the LB node's y toward the
top band and destroying the layout. The doc's one-liner ("keep its y from the LB
chain (the drop is drawn as a connector, not a positioning constraint)") states the
intent but is too easy to miss. Make it explicit in the spec and in code:
*positioning uses structural `winnerTo` topology within a band; `loserTo`/drop
edges are render-only.* Compute from topology, not resolved players, so byes don't
shift positions (deterministic — required by the unit test anyway).

**B2 — The SVG connector layer MUST be `pointer-events: none`.** The plan overlays
one absolutely-positioned `<svg>` spanning the whole canvas, with the tap-to-win
name buttons living on cards in the same coordinate space. If the SVG captures
pointer events it will swallow taps on the ready-match report buttons and silently
break reporting — the sole reporting surface, since the round-list fallback is being
removed (see S3). Set `pointer-events: none` on the SVG (and its children) and give
cards a higher stacking context (`position: relative`/`z-index`) above it. This is a
functional regression risk, not cosmetic — call it out in the spec and cover it in
screenshot verification by actually tapping to advance.

### Should-fix

**S1 — Long cross-band drop connectors will be spaghetti; align LB major-round
columns under their WB drop source.** Drawing a full dashed polyline per `loserTo`
means the WB-final drop runs `winners-R4` (col 3, top band) all the way down to
`losers-R6` (bottom band) diagonally across ~7 columns, and WR3→LR4 / WR2→LR2
cross moderate distances. `loserTo` mapping is fixed and known: WR1→LR1, WR_r→LR(2r-2).
If you place each LB **major** round at the same x-column as its WB drop source
(LR1@col0, LR2@col1, LR4@col2, LR6@col3, with the minor rounds LR3/LR5 at the
half-columns between), every drop edge becomes a near-vertical "loser falls straight
down" line — dramatically more legible and it reads as real flow. This is the single
biggest readability win available and is low-cost given the mapping is static. If
deferred, at minimum render drops heavily de-emphasized (dashed, muted, thin) or as
short labelled exit stubs rather than full-length lines, so they don't dominate the
winner-advance solid edges.

**S2 — Preserve the exact report contract; reuse `ReportBracketNode` rather than
reimplement.** The shipped flow POSTs `{nodeId, winnerId, walkover}` to
`/api/tournaments/${slug}/bracket/report` and refreshes. The plan's "tap a name =
that player won" is fine, but walkover semantics must stay a *persistent toggle read
at tap time* (current UI: set the checkbox, then tap a name; the flag reflects toggle
state). Don't turn walkover into a mode that consumes the next tap. Simplest
non-regressing path: keep `ReportBracketNode`'s fetch/state logic intact and only
restyle it into the card (names as the buttons, a compact "w/o" toggle) — do not
fork the network contract. Keep `router.refresh()` so the server re-runs
`layoutBracket` and redraws after each advance.

**S3 — 44px tap targets vs "compact height" is a real tension; resolve in favor of
a11y.** Ready-match cards need two ≥44px (`h-tap`) name buttons — that's ~88px+ of
card height. Don't shrink name buttons to fit the pyramid. Make **ready** cards
taller (with `h-tap` buttons) and only **static/decided** cards compact. Confirm
`h-tap`/`min-w-tap` (already used in `ReportBracketNode` and the page) are applied
to the tappable names. Note this raises the effective ROW spacing wherever a ready
card sits — fine, but the layout's ROW constant should be ≥ the tallest ready card
so vertically adjacent cards in a column never overlap.

**S4 — Removing the round-list with no fallback is acceptable but raises the bar on
S2/B2.** Because the tree becomes the only place an admin can report a result, a
tree that's usable to *look at* but awkward to *report from* would block tournament
progress, not just degrade aesthetics. The screenshot-iteration plan must explicitly
include: tap a ready name → result advances → tree redraws → champion shows, at
390px. Keep the option to reinstate the list open if reporting proves fiddly (the
doc already hedges this — good).

### Optional

**O1 — Exclude the inert `grand-R2-M1` reset node from layout.** Current
`Bracket.tsx` skips grand round 2 (line 65). `layoutBracket` must filter it out too,
or it places a phantom card. Also decide grand-R1 placement: its two `winnerTo`
sources are `winners-R4-M1` (top band) and `losers-R6-M1` (bottom band); computing
its y as the mean of those two *absolute* (band-offset) positions lands the grand
final neatly in the gap between bands — elegant, recommend it. This requires
computing band y-offsets first, then grand from absolute feeder y.

**O2 — Unit-test assertion for "feeders bracket child's y" must allow equality.**
Major-round LB nodes inherit a single feeder's y (child.y == feeder.y), so a strict
`feeder1.y < child.y < feeder2.y` assertion will false-fail. Assert
`min(feeders.y) <= child.y <= max(feeders.y)` and handle the 1-feeder case. Put the
test next to the existing pure-function precedent (`tests/unit/lap-chart-clip.test.ts`
pattern). Run it for 8-draw, 16-draw, and a bye case (draw 16 / 13 members) as the
doc says.

**O3 — Byes still render as (muted) cards.** The current list shows "bye —
auto-advanced"; keep bye/void nodes positioned and rendered muted in the tree so the
structure stays intact. Positions come from topology so byes don't move anything —
just don't drop the nodes.

---

## Answers to the specific scrutiny points

1. **Positioning algorithm (LB):** Sound and non-overlapping *given B1's definition*.
   The traced 16-draw LB produces distinct y per round and a clean pyramid. The doc
   is underspecified, not wrong — B1 supplies the missing precision.
2. **Connectors:** Banded layout is the right call; interleaving would tangle
   winner-advance and drop edges worse. The long cross-band drops are the weak point
   — S1 (align LB major columns under WB drop sources) turns them near-vertical.
3. **Reporting in the tree:** Cleanly preservable — keep the `{nodeId, winnerId,
   walkover}` contract and reuse `ReportBracketNode` (S2); guard tap-targets (S3) and
   the SVG overlay (B2).
4. **Mobile feasibility:** Achievable. ~7 columns × ~150px ≈ 1050px wide, two stacked
   bands; a `position: relative` canvas of computed width/height with absolute cards +
   an `inset-0` `pointer-events:none` SVG scrolls inside its own `overflow-auto`
   container with no body-level horizontal overflow. Both-axis scroll on a 390px phone
   is acceptable for v1; keep cards compact and ROW tight for non-ready nodes.
5. **Server vs client:** Yes — keep `<Bracket>` a server component. `layoutBracket` is
   pure over static data (numbers in, numbers out), so SSR positions are final; do NOT
   compute positions in a `useEffect` (would flash/shift). Client `ReportBracketNode`
   islands embed exactly as today. No DOM measurement needed because card width is
   fixed and names are CSS-truncated.
6. **Scope:** Extracting `layoutBracket(nodes)` as a pure, unit-tested function is the
   right call and matches the `lapChartClipMaxY` precedent. Nothing major missing for
   v1 beyond O1 (reset-node exclusion) and the round-label header the doc already
   lists as optional.
