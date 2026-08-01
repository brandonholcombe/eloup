# Review — M8c Smash Bros double-elimination bracket

## Reviewer: claude-opus-4.8-m8c-reviewer

Reviews task `m8c-smash-double-elim.md` (Author: `claude-opus-4.8-m8c-implementer`).
Scope per the umbrella: format is FIXED (double-elim, 9–16 players, fixed 16-draw
template, shared ELO). This review checks the concrete build for algorithm and
data-model correctness, since a wrong bracket at a live event is unrecoverable.

## Verdict: **Request-changes**

Three Blocking issues (two of them in the make-or-break algorithm/data model),
three Should-fix, three Optional. The seed order and the aggregate match counts
are correct; the losers-bracket *routing* and the *bye handling during play* are
not implementable as written.

Counts: **Blocking 3, Should-fix 3, Optional 3.**

---

## What checks out (verified against the codebase)

- **Match-count arithmetic is correct.** 16-draw: WB = 8+4+2+1 = 15 (N−1); LB =
  4+4+2+2+1+1 = 14 (N−2); GF = 1 → **30 = 2N−2**. LB is 6 rounds, which is the
  correct `2(log2 16 − 1)` = 6. The stated per-round LB shape
  (LR1 4, LR2 4, LR3 2, LR4 2, LR5 1, LR6 1) is the right skeleton.
- **The 16-seed order is exactly right.** `[1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11]`
  is the canonical recursive mirror-expansion of `[1,2]→[1,4,2,3]→[1,8,4,5,2,7,3,6]→…`.
  I reproduced it; it matches character-for-character. Top seeds are correctly
  spread (1 and 2 in opposite halves).
- **Migration number is correct.** `ls lib/db/migrations/` tops out at `0008_…`;
  `0009_bracket.sql` is the right next number.
- **Byes correctly do NOT touch ELO.** The cascade sets `winner_player_id` with no
  `match_id`/no `matches` row for a walkover-by-bye — right call; a bye must not
  move rating.
- **An admin-authoritative confirm path exists.** `forceConfirmMatch`
  (`lib/db/match.ts:44`) fills unconfirmed `match_participants` and runs the full
  ELO transaction; it is gated by `canForceConfirmMatch` (`lib/permissions.ts:52`,
  used by `app/api/matches/[id]/admin-confirm/route.ts`). So "report → confirm →
  ELO" in one admin action is *reachable* — with the caveats in Should-fix #5.

---

## Blocking

### B1 — Losers routing for the WB final is wrong: WR4 loser must drop to LR6, not GF

The spec's routing line reads:
> `WR1 loser → LR1; WR2 loser → LR2; WR3 loser → LR4; WR4 loser (WBc) → GF; LB winners chain LR1→…→LR6→GF.`

This is incorrect and internally inconsistent:

- WR4 is the **winners final**. Its **winner** is the WB champion (WBc) who goes to
  GF; its **loser** is the WB *runner-up*, who in double-elimination gets a second
  life and MUST drop into the **LB final (LR6)** to play the LR5 winner. Routing
  the WR4 loser to GF (or eliminating them) knocks a player out after a **single
  loss**, which is by definition not double-elimination.
- The `(WBc)` annotation on the *loser* is simply mislabeled — the loser is not the
  champion.
- Structurally, LR6 needs **two** feeds: `W:LR5` and `L:WR4`. As written, the only
  feed into LR6 is the LR5 winner, so **LR6 is a one-entrant non-match** and the
  bracket cannot complete; meanwhile GF is fed by two winners-final players, which
  is nonsensical.

**Correction (explicit tail wiring):**

```
WR4 : winner_to = GF.slot1        loser_to = LR6.slot2
LR5 : winner_to = LR6.slot1
LR6 : p1_source = 'W:LR5'  p2_source = 'L:WR4'   winner_to = GF.slot2
GF  : p1_source = 'W:WR4'  p2_source = 'W:LR6'
```

(Confirms every non-champion is eliminated only after a second loss, modulo the
deferred GF reset in O1.)

### B2 — Data model cannot distinguish "slot waiting for a real feed" from "slot permanently empty (bye)"; advancement can't resolve LB drop-ins

This is the highest-risk correctness hole, and it is the same B2/S1 the umbrella
review flagged — the spec's "resolve at generation" answer is **necessary but not
sufficient**. Walking the required 9-player / 16-draw case (7 byes: seeds 10–16):

- WR1's 8 matches: only M2 (`8 v 9`) is real; the other 7 are byes and produce **no
  loser**. So of LR1's 4 nodes, one gets a single real dropper and **three are
  fully empty (both feeds byes)**.
- The three empty LR1 nodes' winner-feeds propagate emptiness into three LR2 nodes.
  Each LR2 node's *other* slot is a **WR2 loser — a real player not known until WR2
  is played at runtime.**

So at *generation* those LR2 nodes are indeterminate (one dead feed + one
not-yet-played feed). They can only resolve during **advancement**, when the WR2
loser drops in and must **auto-advance** because its LR1-side opponent will never
arrive. But with only `p1_player_id`/`p2_player_id` (NULL = unknown) and **no
resolved/void marker**, the code cannot tell:

- NULL because "the feeding match hasn't been played yet" → **wait**, vs.
- NULL because "the feeding match was a bye and will never produce a player" →
  **auto-advance the opponent**.

The data-model comment "a bye = a slot whose opponent source never resolves" is not
*representable* — "never" and "not yet" are the same NULL. **This makes advancement
undecidable for every LB node downstream of a bye**, which in a 9–15-player draw is
most of the losers bracket.

**Correction:** add an explicit terminal-state marker so a feeding node's "this is a
permanent bye" is queryable. Minimum viable options:

- a node `status` column (`'bye' | 'pending' | 'ready' | 'done'`), or
- per-slot void flags (`p1_void` / `p2_void`), or
- propagate a sentinel into the receiving slot when a feeder is determined to be a
  bye.

Advancement then reads: when a real player lands in a slot and the sibling slot's
source node is a terminal bye, auto-advance (and recurse — see S4).

### B3 — The concrete per-node routing template (the crux) is not specified; "encode the standard wiring" is too vague to build correctly

The spec defers the entire 30-node `winner_to`/`loser_to` table to "the standard
double-elim wiring — encode it as a data template," and gives no explicit slot
mapping for the **LB drop pairings**. That mapping is precisely the part that is
easy to get wrong and is the reason a fixed template was chosen. In particular, when
4 WR2 losers drop into LR2 to meet 4 LR1 winners, standard practice **reverses /
crosses** the droppers' order relative to the LB survivors (and alternates the
cross each drop round) to prevent (a) immediate WB rematches and (b) same-region
collisions. The spec specifies none of this — it says only "WR2 loser → LR2" with no
node-to-node, slot-to-slot assignment.

Per the task's own instruction ("flag if the spec is too vague to implement
correctly"): as written, the make-or-break artifact — the explicit, reviewable
routing table for all 30 nodes including the crossed LB drop order — **does not
exist in the spec**. It must be written out concretely (a literal table keyed by
draw size, e.g. `WR2-M1.loser → LR2-M?.slot?`, with the reversal applied) and
committed to a golden-file unit test that asserts no player faces a WB opponent in
their first LB match. Without it there is nothing to review and high odds of a
subtly invalid bracket.

---

## Should-fix

### S4 — `reportResult` must re-run the bye cascade on drop-in, not only at generation

The advancement section handles only "both `p*_player_id` set → playable." It omits
the case created by B2: a real player drops into a node whose sibling slot is a
terminal bye → that player must **auto-advance immediately** (no match, no ELO), and
that can chain (an auto-advanced player may land in *another* dead-sibling node).
Spell out that advancement recurses the void-aware auto-advance, and add the marker
from B2 so it's decidable.

### S5 — "Create match + confirm + advance, transactional" is not achievable by reusing the existing pieces as-is

`forceConfirmMatch` opens its **own** `db.transaction(...).immediate()` and the
actual ELO core (`applyEloUpdate`) is **module-private** (not exported) in
`lib/db/match.ts`. better-sqlite3 does not allow nesting a transaction inside an
active one, so the report handler cannot wrap `insert + forceConfirmMatch + node
update + advance` in a single outer transaction by calling `forceConfirmMatch`. To
get true atomicity the spec needs to **extract a composable, non-self-transacting
"record bracket result" core** (insert matches/participants with placements 1/2 →
apply ELO → write `winner_player_id`+`match_id` → advance) and run it in one
transaction. Also: the POST `/api/matches` route does **not** run ELO (it inserts
`pending`), so it can't be the reuse point either. Call this refactor out explicitly.

Secondary: the spec allows "admin, **or a participant** of that node" to report. A
non-admin participant only confirms **their own** `match_participants` row
(`confirmRow`), leaving the match `pending` until the opponent confirms — so ELO and
advancement would NOT fire in one action. Decide that bracket reports are
**admin-authoritative / force-confirmed**, or restrict reporting to admins;
otherwise "one atomic action" is false for the participant path.

### S6 — No walkover/no-show path; every report forces an ELO-bearing match

Generation byes correctly skip ELO, but a **mid-bracket no-show** has no path except
`reportResult`, which always creates a real `matches` row and moves rating — i.e. a
phantom win awards/deducts ELO for a game nobody played. Add an admin
"advance-without-ELO" (walkover) action for no-shows, distinct from a played result.

---

## Optional

### O7 — Tests: add the specific high-risk assertions, not just "reaches one champion"

The 9- and 13-player cases will *exercise* the bye paths, but the test list should
assert them directly: (a) a **fully-empty LB node** (both feeds byes) produces no
winner and propagates void; (b) a **WR2/WR3 loser dropping into a dead-sibling node
auto-advances** without a `matches` row; (c) the **WR4 loser lands in LR6** (guards
B1); (d) **no player meets a WB opponent in their first LB match** (guards B3's
cross). Add a 15-player (1 bye) minimal case. Consider stating the pure functions
operate on **in-memory node structures**, not a `Database` handle, so the unit tests
need no DB (the spec says "pure" but the advancement prose writes columns directly).

### O8 — Include the 8-draw and ≤4-draw templates, or state they're stubs

Only the 16-draw is detailed. 8-draw should be 2N−2 = 14 (WB 4+2+1, LB 2+2+1+1, GF).
Since 9–16 (16-draw) is the committed path this is low priority, but the "template
keyed by draw size" claim implies these exist — either provide them or scope them
out explicitly.

### O9 — GF-reset deferral is honest but means this isn't strict double-elim

Pre-allocating an inert GF2 (O1) and stating "single grand final" inline is a clean,
disclosed MVP simplification — accepted. Note only that the WB champion's
"undefeated" advantage is nullified if they lose GF; fine for a party MVP as long as
the inline note stays.

---

## Bottom line for the two must-verify areas

- **(a) Losers-bracket routing: INCORRECT as written (B1 + B3).** The WB-final loser
  is misrouted to GF instead of LR6 (a one-loss elimination — not double-elim), and
  the concrete per-node drop-pairing table (with the standard crossed LB drop order)
  is entirely unspecified. Both must be fixed and pinned by a golden-file test.
- **(b) Bye-cascade termination: does NOT hold during play (B2 + S4).** Generation
  terminates at a valid *winners* frontier, but the model cannot distinguish a
  permanent LB bye from a not-yet-played feed, so LB drop-ins downstream of byes are
  undecidable — which is most of the losers bracket in any 9–15-player draw. Needs a
  terminal-state marker plus a void-aware auto-advance that recurses on drop-in.

Fix B1–B3 (and fold in S4–S6) and this is a solid, testable build. Until then,
Request-changes.
