# M8c.3 — Bracket tree UI (visual pyramid + flow)

## Author: claude-opus-4.8-m8c3-implementer
## Status: Complete

## Outcome (2026-08-01) — SHIPPED, verified live

Reworked `<Bracket>` from round-lists into a visual pyramid tree.
- `lib/bracket/layout.ts`: pure `layoutBracket(nodes)` → boxes + edges (15 unit
  tests: no overlaps, winners-parent-between-feeders pyramid, losers band below,
  valid edges — for 8/13/16 draws). B1 rule (same-band winnerTo feeders only),
  S1 columns (WB drops land vertically over their LB target).
- `components/Bracket.tsx` (server): SVG connector layer (`pointer-events:none`,
  B2) with solid winner elbows + dashed loser drops; absolutely-positioned cards.
- `components/BracketCard.tsx` (client): tap-a-name-to-win on ready matches + a
  tiny w/o (walkover) toggle. Replaced `ReportBracketNode` (removed).
- Verified live in the harness (13-member bracket): all 30 nodes across 8
  columns + 44 connectors; pyramid + winner/loser flow reads correctly; byes
  labeled; **tap-to-win POST 200 through the SVG overlay** (B2 holds); scrolls
  both directions on 390px.
- vitest 342 → 357. No schema/symbol change.

## Reviewer findings folded (2026-08-01)

Review at `Agents/Review-reports/m8c3-bracket-tree-ui-review.md`: **Approve-with-
changes** — 2 blocking, 4 should-fix. The reviewer TRACED a full 16-draw LB and
confirmed the pyramid works. Folded:
- **B1 (positioning rule, pinned):** a node's y = mean of its **same-band
  `winnerTo` feeders ONLY** (reverse of winnerTo, same bracket band); EXCLUDE the
  WB dropper (the `loserTo` edge). So WB round r+1 (2 feeders) → midpoint; LB
  major rounds (1 LB feeder) → inherit; LB minor merges (2 LB feeders) → midpoint.
  Band round-1 nodes (WR1, LR1: no same-band winner feeders) → evenly spaced
  within their band. Grand final → mean of WB-final + LB-final y (special-cased).
  Traced LB rows: LR1 .5/1.5/2.5/3.5 → LR2 inherit → LR3 1/3 → LR4 inherit → LR5 2
  → LR6 inherit. No collisions. (The WRONG impl — averaging slot1/slot2 — would
  pull LB nodes into the winners band; do NOT do that.)
- **B2:** the overlay `<svg>` connector layer MUST be `pointer-events: none` or it
  swallows the tap-to-win report buttons (a reporting regression). Cards sit above.
- **S1:** align LB columns under their WB drop source so `loserTo` drops render
  near-vertical: WB col = `2*(round-1)` (WR1=0,WR2=2,WR3=4,WR4=6); LB col = `round`
  (LR1=1..LR6=6); GF col = max+1 (7). Then WR2→LR2, WR3→LR4, WR4→LR6 drops are
  vertical.
- Confirmed sound: server `<Bracket>` + pure `layoutBracket` + client
  `ReportBracketNode` islands, no SSR issue.

## Parent / context

Follow-up to `m8c-smash-double-elim.md` (shipped). The MVP shipped round-by-round
match LISTS (deferred the visual tree as a non-goal). The user now wants the
**pyramid/flow** — a real bracket tree with connector lines showing winners
advancing and losers dropping. This reworks the `<Bracket>` presentation ONLY;
the engine, data model, persistence, report/shuffle logic are UNCHANGED.

## Goal

A recognizable, mobile-usable double-elim **bracket tree**: rounds as columns
left→right, match cards positioned to form the pyramid, connector lines drawn
from each node's `winnerTo`/`loserTo` so the flow is visible (winners → right,
losers → dropping into the losers bracket → grand final). Horizontally
scrollable on a phone.

## Layout approach (the crux — pure position math, unit-testable)

Compute an (x, y) for every node from the engine node graph, then render
absolutely-positioned HTML cards + an SVG connector layer behind them.

- **x (column):** by section + round. Winners rounds 1..R → columns 0..R-1.
  Losers rounds map to their own column indices (interleave under winners or a
  separate row band — see below). Grand final → the rightmost column.
- **y (row) — bottom-up midpoint rule (gives the pyramid):**
  - Round-1 winners matches: evenly spaced, `y = (position - 0.5) * ROW`.
  - A later winners match's `y = midpoint of its two feeder matches` (round r+1
    match p is fed by round r matches 2p-1 and 2p). This is the classic pyramid
    alignment.
  - Losers bracket: same midpoint rule down its `winnerTo` chain; where a node
    also receives a WB drop (`loserTo` target), keep its y from the LB chain (the
    drop is drawn as a connector, not a positioning constraint).
- **Bands:** Winners tree in a top band; Losers tree in a band below it; Grand
  final to the right spanning between. Compute each band's height from its node
  count; stack bands with a gap.
- Extract the positioning as a **pure function** `layoutBracket(nodes) →
  {positions: Map<id,{x,y}>, width, height, edges}` so it is unit-tested (assert
  no overlap, feeders bracket their child's y, width/height bounds) without a DOM.

## Rendering

- A scroll container (`overflow-x-auto`, `overflow-y-auto` if needed) sized to the
  computed canvas; horizontal pan on mobile.
- **Connector layer:** one absolutely-positioned `<svg>` (matches the project's
  `chart_strategy: svg_inline`) spanning the canvas; draw an elbow polyline from
  each node's right-mid to its `winnerTo` target's left-mid (solid), and from
  each node to its `loserTo` target (dashed/muted — the "drop"). Byes: a node with
  a void feed shows a short stub / "bye".
- **Match cards** (absolutely positioned, compact): two entrant rows (name,
  winner highlighted emerald + ✓; TBD/bye muted). Keep names truncated to a fixed
  card width. Champion node badged 🏆.
- **Reporting stays functional (reuse, don't regress):** a `ready` match for an
  admin makes each entrant name a **tap-to-win button** (tap a name = that player
  won → existing `/bracket/report`); the walkover option remains reachable (a
  small secondary control on the card, or a long-press — keep it simple, e.g. a
  tiny "w/o" toggle). Non-ready cards are static. This preserves the shipped
  report flow through the tree.
- Champion banner + the "single grand final (no reset)" note stay.
- The Shuffle button (admin, pre-start) stays above the tree.

## Mobile considerations
- 16-draw is wide; horizontal scroll is expected and fine. Cards ~140px wide,
  compact height. Consider a subtle round-label header row that scrolls with the
  columns.
- Test at 390px: the tree scrolls, cards are legible, tap-to-win works, no
  body-level horizontal overflow (the tree scrolls inside its own container).
- Keep the existing round-by-round list as a fallback? NO — replace it; the tree
  is the view. (If the tree proves unusable for reporting, revisit.)

## Testing / verification
- Unit: `layoutBracket` — positions computed, feeders bracket child y, no card
  overlaps within a band, deterministic; run for 8- and 16-draw + a bye case.
- `pnpm lint`/`typecheck`/`build`/`test` green (engine/report tests unchanged).
- **Heavy screenshot iteration** in the local harness (seeded 13-member bracket):
  the pyramid reads correctly, connectors follow winner_to/loser_to, tap-to-win
  advances and redraws, champion shows. This visual task is validated primarily
  by screenshots.
- No schema/symbol change.

## Non-goals (v1)
Pinch-zoom, a minimap/overview, the 1080p projection variant (separate surface),
animated transitions. Just a clean, scrollable, connected tree with working
reporting.

## Review gate
Edits `eloup-web/` (a new layout lib + reworked `<Bracket>`). Needs an independent
review by a different agent than `## Author:`, referencing `m8c3-bracket-tree-ui.md`,
before implementation — focus on the layout-positioning approach (does the
midpoint rule + banded WB/LB actually produce a non-overlapping readable tree?)
and that reporting/walkover isn't regressed.
