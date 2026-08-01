# Review — M8 Tournament formats (bracket / cup / round-robin)

## Reviewer: claude-opus-4.8-m8-reviewer

Reviews `Agents/TODO/Active/m8-tournament-formats.md`
(Author: `claude-opus-4.8-m8-planner`).

Scope: this is a **plan/design review**, not an implementation review. The
user's three format choices (double-elim Smash, RC points-series cup, round-robin
board game) are FIXED and not evaluated. I evaluate soundness, completeness, and
fidelity to the actual schema.

## Verdict: **Approve-with-changes**

The umbrella framing is good: MVP-first, mobile match-lists over rendered trees,
fixed-template bracket, reuse of the RC module and M5 permissions. The build
sequencing is sensible. But there is one factual contradiction that must be
resolved before 8b is specced, and the double-elim data model (§8c) is missing
the columns that make advancement actually representable. Both are fixable
inside the sub-task docs; the umbrella direction is sound.

Counts: **2 Blocking**, **5 Should-fix**, **3 Optional**.

---

## Blocking

### B1 — §2 ELO claim is false for the RC cup (RC is display-only; no `matches` rows)
§2 states flatly: "Tournament matches create real `matches` rows → normal confirm
+ per-game + overall ELO." This is true for Smash and the board game, but **not**
for the RC points-series cup. RC racing is **display-only** — `docs/racing.md`:
"R1 is display-only — race results do not affect any ELO rating. ELO integration
is planned as a follow-up (R2)". The RC tables (`rc_races`, `rc_race_drivers`,
`rc_laps`) are an entirely separate universe from `matches`/`match_participants`;
there is no code path that turns an RC race into a `matches` row, and R2 (the
work that would build one) is explicitly deferred and unbuilt.

Consequence: the RC cup (8b) produces **no `matches` rows and feeds no ELO at
all**. Its standings are computed purely over `rc_race_drivers.placement`. So:
- Q-M8-1 ("shared ELO vs isolated pool") is **moot for 8b** — there is no ELO
  either way. The question only applies to 8a and 8c.
- §2's blanket statement must be rewritten to scope ELO to the two `matches`-backed
  formats and explicitly say the RC cup is standings-only (no ELO), consistent
  with the R1 display-only decision. Otherwise 8b will be specced against a data
  flow that does not exist.

### B2 — Double-elim data model (§8c) cannot represent a slot's occupants
The proposed `bracket_matches(... p1_source, p2_source, match_id, winner_to_id,
winner_to_slot, loser_to_id, loser_to_slot, winner_player_id, loser_player_id)`
has routing columns and an outcome (`winner_player_id`/`loser_player_id`) but
**no column to hold the two resolved entrants of the node itself** (e.g.
`p1_player_id` / `p2_player_id`). Advancement is defined as "fill winner → its
`winner_to` slot" where a slot is `(winner_to_id, winner_to_slot ∈ {p1,p2})` — but
there is nowhere to *write* that player, because the target node only stores
`p1_source`/`p2_source` (static routing) and its own eventual winner/loser. You
can technically derive an occupant by chasing `p*_source` back to the source
node's `winner_player_id`/`loser_player_id`, but that makes "who is in this slot,
is it ready to play?" a recursive traversal instead of a column read, and it
interacts badly with byes (see S1).

Fix: add resolved-entrant columns `p1_player_id NULL`, `p2_player_id NULL` that
advancement writes into. Then a node is playable when both are non-NULL, a bye is
a node where one is a player and the other is a permanent NULL/`BYE` sentinel, and
`winner_player_id`/`loser_player_id` become derived-on-report rather than the only
occupancy signal. This is the central modeling gap; without it §8c is not
buildable as written.

---

## Should-fix

### S1 — Bye propagation must cover the *losers*-bracket empty feed, not just winners
§8c says "auto-propagate byes at generation." In a 16-draw seeded with 9 players,
7 winners-R1 matches are byes. A bye match has a winner but **no loser** — so the
losers-bracket R1 slot that expects "loser of winners-R1 match X" receives
nothing and is itself a bye that must cascade. The plan only describes propagating
the *winner* forward. The design must state that a bye also produces an empty
`loser_to` feed and that the receiving losers-bracket slot auto-advances its other
entrant. With 7 byes in a 9-player draw this cascade is the common case, not an
edge case, so it needs to be explicit in the fixed template, not discovered during
implementation.

### S2 — §8b misidentifies the placement-bearing table (`rc_race_drivers`, not `rc_drivers`)
§8b says it "reuses `rc_races`/`rc_drivers`/`rc_laps` wholesale." The per-race
**finishing position lives on `rc_race_drivers.placement`** (`0003_rc_racing.sql`:
`rc_race_drivers(race_id, driver_id, transponder_id, placement, laps_completed,
best_lap_ms, total_time_ms, PRIMARY KEY(race_id, driver_id))`), read by
`standingsForRace()` in `lib/db/rc.ts`. `rc_drivers` is the *global* driver
identity (no placement). Good news: the capability the cup needs — points-by-finish
per race — is **fully supported** via `rc_race_drivers.placement` (1-based, already
computed and admin-editable via `setDriverPenalty`/`setVoidedLapsCount`
recompute). But the plan names the wrong table; 8b should point at
`rc_race_drivers` / `standingsForRace()` as the join source.

### S3 — Q-M8-5: cup standings must key on **driver**, mapping to player for display
`rc_drivers.player_id` is **nullable** — the Discord link is optional
(`0003_rc_racing.sql`; `setDriverPlayer` allows NULL). Keying cup standings on
`player_id` would silently drop every unlinked driver's points. Recommendation:
key on `driver_id` (the entity that actually has `placement` rows), and resolve
the linked player only for display / to correlate with `tournament_members`.
Flag the mismatch that tournament membership is player-based while RC results are
driver-based: 8b needs an explicit rule for unlinked drivers (include as a
driver-only row, or require the admin to link before cup start). Answer Q-M8-5 as
"driver, display linked player," not "linked player."

### S4 — Round-robin pools need NEW standings code; existing `getStandings` is not pool-aware
The N-choose-2 analysis is **correct** (16 → 16·15/2 = 120; 9 → 36). Pools for
>~8 is the right mitigation and correctly left open for the sub-task. But note the
interaction the plan doesn't: `lib/tournament-standings.ts::getStandings` is
tournament-wide (anchored on `matches.tournament_id` + `status='confirmed'`, wins
= `placement=1`) with **no pool dimension** and **no loss column** (only wins /
matches_played / overall_rating tiebreakers). A pooled round-robin needs a pool
label on the schedule rows and a pool-segmented standings query — that is net-new
code, not an extension of the current query. Also, the current query's join order
is load-bearing (documented in the file and `docs/tournaments.md`: anchor on
`matches`, join `match_participants` through it, or casual matches leak into the
counts) — any new standings variant must preserve that shape.

### S5 — §6: name the next migration number and the required `games` rows
`symbols/manifest.json` does have a `tournaments` symbol (line 88) with
`docs: ["docs/tournaments.md"]`, so the "update symbol property + docs + `align.py
lock`" instinct is correct — good. Two concrete gaps: (a) the next migration is
**`0009_*.sql`** (existing run ends at `0008_games_category.sql`) — state it so
the three sub-tasks don't collide on numbers; (b) both `matches`-backed formats
need a `games` row to exist — `matches.game_id` is `NOT NULL` and `games.format`
is `CHECK IN ('1v1','ffa','team')` (Smash → `1v1`, board game → `1v1`). The plan
assumes "game = Smash / the board game" without noting these rows must be created
(and, post-`0008`, categorized). The RC cup needs **no** games row (it never
touches `matches`).

---

## Optional / notes

### O1 — Deferring the grand-finals bracket reset is acceptable if made an explicit rule
Deferring the reset (§8c, Q-M8-3) is fine for MVP, but it changes the format:
without a reset, grand finals is single-game/winner-takes-all and the
winners-bracket champion's "one life advantage" is discarded. That's a legitimate
casual simplification — but document it as a **stated tournament rule** shown in
the UI, not a silent gap, and pre-allocate a `'grand'` round-2 node in the fixed
template so adding the reset later is data-only. When the reset *is* added under
shared ELO, note it's a 2nd back-to-back ELO-affecting `matches` row between the
same pair (mechanically fine — two matches, two updates — just intended).

### O2 — Same-pair double-count under shared ELO is fine, but call it out
In double-elim the same two players can legitimately meet twice (winners-final
loser drops and can re-meet the winner in grand finals). Under shared ELO each is
an independent `matches` row → independent ELO update. That's consistent with the
existing confirm/ELO flow (nothing dedupes pairs) and is not a bug — worth a
one-line note so it isn't "fixed" later.

### O3 — Missing MVP concern: mid-event roster change
The fixed template is generated once at seeding; byes cover absent seeds, but a
**late entrant or a drop mid-event** has no path (bracket is fixed). For a
bachelor party this is probably acceptable — but state it as a known limitation
(admin re-seeds/regenerates before any result is reported, and cannot after).
Result reporting on a phone (§2 match-lists + "report result" button) and
points-series tiebreakers (wins → best finish) are otherwise adequately covered
for an MVP.

---

## Summary of required changes before sub-tasks are specced
1. Rewrite §2 ELO scope: ELO applies to 8a/8c only; the RC cup is standings-only,
   no `matches` rows, no ELO (B1). Retire Q-M8-1 for 8b.
2. Add resolved-entrant columns to `bracket_matches` (`p1_player_id`,
   `p2_player_id`) and define playability/bye in terms of them (B2, S1).
3. Repoint 8b at `rc_race_drivers.placement` / `standingsForRace()`; key cup
   standings on `driver_id` with a rule for unlinked drivers (S2, S3).
4. Note that pools require net-new pool-aware standings code preserving the
   existing join-order invariant (S4).
5. Fix §6: next migration `0009_*`; create `games` rows for Smash + board game;
   none for the RC cup (S5).
