# M8c — Smash Bros double-elimination bracket

## Author: claude-opus-4.8-m8c-implementer
## Status: Not Started

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
  -- Resolved entrants (B2): advancement WRITES these. Playable = both non-NULL
  -- and no winner yet. A bye = a slot whose opponent source never resolves.
  p1_player_id   TEXT REFERENCES players(id),
  p2_player_id   TEXT REFERENCES players(id),
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

Routing per node (winner_to / loser_to) is the standard double-elim wiring —
encode it as a **data template** keyed by draw size, generated into
`bracket_matches` rows. WR1 loser → LR1; WR2 loser → LR2; WR3 loser → LR4; WR4
loser (WBc) → GF; LB winners chain LR1→LR2→…→LR6→GF.

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

`reportResult(bracketMatchId, winnerPlayerId)`:
1. Set `winner_player_id`; loser = the other entrant.
2. Write winner into `winner_to` slot (`winner_to_slot` → p1/p2_player_id of
   `winner_to_id`); write loser into `loser_to` slot if `loser_to_id` set, else
   loser is eliminated.
3. A target node becomes playable when both `p*_player_id` are set.
4. If GF is decided and no reset (v1), the GF winner is champion. (O2: the same
   pair can meet in WF-drop→GF — two independent matches, two ELO updates,
   intended.)

## Result reporting + ELO (shared-ELO)

Reporting a bracket result **creates a real `matches` row** (game = Smash `1v1`,
`tournament_id` set, the two `p*_player_id` as participants, winner placement 1)
and runs the **existing confirm → ELO** path, then calls `reportResult` to
advance. One admin/participant action, transactional. This satisfies the
shared-ELO decision and reuses M4/M5 plumbing. A **Smash `games` row** must exist
(format `1v1`, a sensible category) — seed/create it (S5).

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
