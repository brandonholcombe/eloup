# M8c — Smash Bros double-elimination bracket

## Author: claude-opus-4.8-m8c-implementer
## Status: Complete

## Outcome (2026-08-01) — SHIPPED, verified end-to-end

The flagship Smash double-elim bracket is built and works on a phone.
- **Engine** (`lib/bracket/engine.ts`) — pure, 15 golden invariant tests prove:
  2N-2 counts, every non-champion out with exactly 2 losses, bye cascade
  terminates for 9/11/13/15 players, WR-final loser→LR6 (B1), no WB rematch in
  first LB match (B3 cross). All reviewer blocking bugs fixed + tested.
- **Persistence + ELO** (`0009_bracket.sql`, `lib/db/bracket.ts`) — 5 integration
  tests: create/round-trip, full tournament→champion + ELO fired, walkover no-ELO,
  rejects double-create/bad reports. `recordBracketResult` composes the exported
  `applyEloUpdate` in one transaction (S5).
- **API + UI** — generate (seeded by ELO), round-by-round match lists, admin
  winner-report + walkover, champion banner. Verified live in the local harness
  (13-member → 16-draw with byes auto-advanced; report POST 200 advances).
- **Alignment** — `tournaments` symbol + `docs/tournaments.md` updated (stale "no
  brackets" phrase fixed); `align.py lock` re-run (root `aec87586`, aligned).
- vitest 308 → 328. Deferred (v1, stated): grand-final reset, mid-event roster.

## Reviewer findings folded (2026-08-01)

Review at `Agents/Review-reports/m8c-smash-double-elim-review.md` (Reviewer:
`claude-opus-4.8-m8c-reviewer`): **Request-changes** — 3 blocking, 3 should-fix.
Match counts + 16-seed order + migration number verified correct; the losers
routing and bye-during-play were NOT implementable as written. All folded:
- **B1 (routing bug):** WR4 *loser* is the WB runner-up and MUST drop to **LR6**
  (losers final), not GF — routing it to GF was a one-loss elimination (not
  double-elim). Corrected tail wiring below.
- **B2 (data model):** NULL can't distinguish "waiting for a feed" from
  "permanently a bye," making LB drop-ins downstream of byes undecidable. Added a
  per-node **`status`** marker (`bye|pending|ready|done`) + per-slot void so
  advancement is decidable.
- **B3 (the crux):** the concrete 30-node routing — especially the **crossed LB
  drop order** (WR2 losers reversed vs LR1 winners to avoid immediate WB
  rematches) — was unspecified. Now built by a **principled recursive generator**
  and pinned by **golden invariant tests** (esp. "no player meets a WB opponent in
  their first LB match").
- **S4:** `reportResult` recurses the void-aware auto-advance on drop-in.
- **S5:** extract a composable, non-self-transacting **`recordBracketResult`**
  core (insert match+participants placements 1/2 → apply ELO → set
  winner+match_id → advance) in ONE transaction — `forceConfirmMatch` opens its
  own txn and `applyEloUpdate` is private, so they can't be nested. Bracket
  reports are **admin-authoritative** (not participant-confirmed).
- **S6:** add an admin **walkover / no-show** advance (no `matches` row, no ELO),
  distinct from a played result.
- Tests (O7): assert fully-empty LB node → void; WR2/WR3 loser into dead-sibling
  auto-advances w/o a match; WR4 loser lands in LR6; no WB rematch in first LB;
  add 15-player (1 bye) + 13/9-player cases; pure fns operate on **in-memory node
  structures** (no DB handle) so unit tests need no DB.

## Parent

Sub-part of `m8-tournament-formats.md` (umbrella, reviewed Approve-with-changes).
This is the **committed, critical-path deliverable** (user: Smash-first; RC cup +
board-game round-robin are optional/by-hand). Incorporates the umbrella review's
B2/S1/O1/O2/O3/S5 corrections.

## Goal

A tournament of `format='double_elim'` gets a **double-elimination bracket** for
its members (9–16, or ≤8): admin seeds → generate → players report results on a
phone → winners/losers advance automatically → a champion. Shared ELO: each
bracket match is a real `matches` row (game = Smash, `1v1`) feeding per-game +
overall ELO.

## Data model — migration `0009_bracket.sql`

```sql
CREATE TABLE bracket_matches (
  id             TEXT PRIMARY KEY,
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id),
  bracket        TEXT NOT NULL CHECK (bracket IN ('winners','losers','grand')),
  round          INTEGER NOT NULL,          -- 1-based within bracket
  position       INTEGER NOT NULL,          -- 1-based within (bracket, round)
  -- Terminal-state marker (B2) so "permanent bye" is queryable, not just NULL:
  --   'pending' = waiting on a feed; 'ready' = both entrants set, playable;
  --   'done' = result recorded; 'bye' = node auto-resolved (walkover/no opponent).
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','ready','bye','done')),
  -- Resolved entrants (B2): advancement WRITES these. A per-slot void flag marks
  -- "this feed is a permanent bye, will never arrive" vs NULL "not yet played".
  p1_player_id   TEXT REFERENCES players(id),
  p2_player_id   TEXT REFERENCES players(id),
  p1_void        INTEGER NOT NULL DEFAULT 0,   -- 1 = this slot's feed is a bye
  p2_void        INTEGER NOT NULL DEFAULT 0,
  -- Static routing (set at generation): where each entrant comes FROM.
  --   'seed:<n>' | 'W:<bracket_match_id>' | 'L:<bracket_match_id>'
  p1_source      TEXT NOT NULL,
  p2_source      TEXT NOT NULL,
  -- Where winner / loser GO (NULL loser_to = eliminated). slot ∈ {1,2}.
  winner_to_id   TEXT REFERENCES bracket_matches(id),
  winner_to_slot INTEGER CHECK (winner_to_slot IN (1,2)),
  loser_to_id    TEXT REFERENCES bracket_matches(id),
  loser_to_slot  INTEGER CHECK (loser_to_slot IN (1,2)),
  -- Result: written on report; match_id links the real ELO-bearing match.
  match_id           TEXT REFERENCES matches(id),
  winner_player_id   TEXT REFERENCES players(id),
  UNIQUE (tournament_id, bracket, round, position)
);
CREATE INDEX idx_bracket_matches_tournament ON bracket_matches(tournament_id);
```

`tournaments.format` (existing nullable TEXT) = `'double_elim'` marks a bracketed
tournament. No new column there for MVP.

## Fixed-template generation (the crux — pure, unit-tested)

Generate a **fixed power-of-2 draw** (16-slot for 9–16 players, 8-slot for 5–8,
4-slot for ≤4). NOT arbitrary-N — the template's routing is precomputed, which is
why this is tractable.

**16-draw double-elim structure** (2N−2 = 30 matches; +1 grand-final reset node
pre-allocated per O1):
- Winners: WR1 8 → WR2 4 → WR3 2 → WR4 1 (WB champion)
- Losers: LR1 4, LR2 4, LR3 2, LR4 2, LR5 1, LR6 1 (LB champion)
- Grand: GF (WBc vs LBc); GF2 reset node pre-allocated but INERT in v1 (O1).

**Routing built by a principled recursive generator, not hand-prose (B3).** The
per-node `winner_to`/`loser_to` wiring — especially the LB drop pairings — is
generated by a documented algorithm and then **pinned by golden invariant tests**
(so a subtly-wrong table cannot ship). Key rules the generator implements:
- WB losers drop into the LB: WR1 losers → LR1; WR2 losers → LR2; WR3 losers →
  LR4; **WR4 loser → LR6** (the WB runner-up gets a 2nd life; B1 fix — NOT GF).
- LB winners advance LR1→LR2→…→LR6; LR5 winner → LR6.slot1; **LR6 (LB final):
  `p1='W:LR5'`, `p2='L:WR4'`, winner → GF.slot2**.
- Grand final: `p1='W:WR4'` (WB champ), `p2='W:LR6'` (LB champ).
- **Crossed drop order (B3):** when the 4 WR2 losers drop into LR2 to meet the 4
  LR1 winners, the droppers are placed in **reversed** order relative to the LB
  survivors (and the cross alternates each drop round) to avoid immediate WB
  rematches and same-region collisions. This is the exact part the golden test
  guards: **no player faces a WB opponent in their first LB match.**

Corrected tail wiring (explicit, from the review):
```
WR4 : winner_to = GF.slot1        loser_to = LR6.slot2
LR5 : winner_to = LR6.slot1
LR6 : p1='W:LR5'  p2='L:WR4'      winner_to = GF.slot2
GF  : p1='W:WR4'  p2='W:LR6'
```

**Seeding:** default order by current overall ELO desc (admin may reorder). Place
into WR1 using standard 16-seed order `[1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11]`
so top seeds are spread and meet late. Seeds > playerCount are **byes**.

**Bye resolution cascade (B2/S1) — resolve at generation, transitively:**
1. Seed real players into WR1 `p1/p2_player_id`; a slot facing a bye seed has one
   real player + the other entrant permanently absent.
2. For any playable-by-default slot (one real player, opponent is a bye), the real
   player auto-wins: set `winner_player_id`, write them into `winner_to` slot.
   Its `loser_to` feed produces **nothing** (a bye has no loser) → the receiving
   losers slot's that-entrant stays absent.
3. Repeat until stable — a losers slot receiving an empty feed becomes a bye
   itself and cascades. With 7 byes in a 9-player 16-draw this fires many times;
   it's the common path, must be covered by tests.

Output: a fully-wired bracket where the initially-playable nodes have both
`p*_player_id` set and no `winner_player_id`.

## Advancement (pure, unit-tested)

`advanceWinner(node, winnerPlayerId)` — pure, operates on in-memory nodes (O7):
1. Set node `winner_player_id`, `status='done'`; loser = the other entrant.
2. Write winner into `winner_to` slot; write loser into `loser_to` slot if set,
   else loser is eliminated.
3. **Void-aware auto-advance (S4/B2):** after writing an entrant into a target
   slot, if that target's *sibling* slot is void (its feeding node is a terminal
   `bye`, or the feed produced no player), the just-arrived player **auto-advances
   immediately** — no match, no ELO — and this **recurses** (an auto-advanced
   player may land in another dead-sibling node). A node with both feeds void is
   itself a `bye` producing no player, propagating void onward.
4. A node becomes `ready` when both `p*_player_id` set and neither void.
5. GF winner (no reset, v1) = champion. (O2: a WF-drop→GF rematch is two
   independent `matches` rows → two ELO updates — intended, not a bug.)

The **bye cascade at generation** is the same routine seeded from WR1 walkovers,
then run to a fixed point — so generation and play share one void-aware engine.

## Result reporting + ELO (shared-ELO)

Reporting a played bracket result is **admin-authoritative** (S5 — a non-admin
participant only confirms their own row, leaving the match `pending`, so ELO +
advancement wouldn't fire in one action). It creates a real `matches` row (game =
Smash `1v1`, `tournament_id` set, the two entrants, winner placement 1) that
feeds per-game + overall ELO.

**Composable core (S5):** the existing pieces can't be reused as-is —
`forceConfirmMatch` opens its OWN `db.transaction().immediate()` and the ELO core
`applyEloUpdate` is module-private, so they can't be nested; and POST
`/api/matches` inserts `pending` (no ELO). Extract a non-self-transacting
**`recordBracketResult(handle, {bracketMatchId, winnerPlayerId})`** that, in ONE
outer transaction: inserts the `matches` + `match_participants` (placements 1/2,
pre-confirmed) → applies the ELO update → sets `winner_player_id`+`match_id`+
`status='done'` → runs `advanceWinner`. Extract/expose the ELO core so it's
callable inside this transaction.

- **Walkover / no-show (S6):** a separate admin `recordWalkover(bracketMatchId,
  winnerPlayerId)` advances the winner with **no `matches` row and no ELO**
  (distinct from a played result) — for mid-bracket no-shows.
- A **Smash `games` row** must exist (format `1v1`, sensible category) — create it
  in migration `0009` or a seed step.

## UI (mobile match-lists, NOT a rendered tree)

- `/tournaments/[slug]` (format=double_elim): show the bracket as **round-by-round
  match lists** — sections "Winners R1…", "Losers R1…", "Grand Final", each a list
  of nodes with the two entrants (or "TBD"/"bye"), and a **Report result** action
  on playable nodes (admin, or a participant of that node). Champion banner when
  decided. State the "no bracket reset — single grand final" rule inline (O1).
- Admin: a **Create bracket** action (seed by ELO, optional reorder, confirm →
  generate). Mid-event roster changes unsupported — regenerate before any result
  is reported; locked after (O3, shown as a note).
- Reuse `<Card>`, `<Button>`, tokens, medals from the UX overhaul.

## Testing / verification

- **Heavy unit tests on the pure functions** (generation + bye cascade +
  advancement): 16-draw with 16/9/13 players (bye cascades), 8-draw, ≤4; assert
  match counts (2N−2), every node's routing, that byes auto-advance into both
  brackets, and a full simulated tournament reaches one champion.
- Integration: create a double_elim tournament, generate, report through to a
  champion; assert ELO updates fired (real `matches` rows) and standings/order.
- `pnpm lint`/`typecheck`/`build`/`test` green; verify via the local seeded
  screenshot harness (bracket lists render, report advances, champion shows).
- Migration `0009` applies cleanly (fresh + on top of `0008`).
- `tournaments` symbol + `docs/tournaments.md` updated; `align.py lock` re-run.

## Non-goals (v1)

Grand-final bracket reset (node pre-allocated, inert); mid-event add/drop; the
visual connected tree (projection-surface/later); RC cup + round-robin (8b/8a).

## Review gate

Edits `eloup-web/` (migration + lib + UI) + `symbols/`. Needs an independent
review by a different agent than `## Author:`, referencing `m8c-smash-double-elim.md`,
before implementation — focus on the generation/bye-cascade correctness and the
`matches`-row-per-bracket-result ELO integration.
