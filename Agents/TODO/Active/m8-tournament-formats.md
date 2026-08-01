# M8 — Tournament formats for the bachelor party (bracket/cup/round-robin)

## Author: claude-opus-4.8-m8-planner
## Status: In Progress

> Umbrella design doc for the "bracket builder." Each sub-part gets its own task
> doc + review + build.

## Reprioritization (user, 2026-07-31) + reviewer findings folded

**User: build the Smash Bros double-elim bracket (8c) FIRST. The RC cup (8b) and
board-game round-robin (8a) are OPTIONAL — can be run by hand if needed.** So 8c
is the critical path and the only committed deliverable; 8a/8b are nice-to-have.

Independent review at `Agents/Review-reports/m8-tournament-formats-review.md`
(Reviewer: `claude-opus-4.8-m8-reviewer`): **Approve-with-changes** — 2 blocking,
5 should-fix. Umbrella direction sound. Corrections:
- **Decisions locked:** Q-M8-1 → **shared ELO for 8a/8c** (each match is a real
  `matches` row → per-game + overall ELO); **RC cup 8b has NO ELO** — it's
  standings-only over `rc_race_drivers.placement` (RC is display-only; B1). Q-M8-4
  → **Smash-first**. Q-M8-5 → **key cup standings on `driver_id`**, display linked
  player (`rc_drivers.player_id` is nullable; S3).
- **B2 (critical for 8c):** the `bracket_matches` model as sketched CANNOT hold a
  slot's resolved occupants — needs `p1_player_id`/`p2_player_id` columns that
  advancement writes into (playable = both non-NULL; bye = one player + a BYE
  sentinel). Corrected in the 8c sub-task doc below.
- **S1 (8c):** bye propagation must cascade into the **losers** bracket too — a
  winners-R1 bye has a winner but no loser, so the losers slot expecting that
  loser is itself a bye that auto-advances. With 7 byes in a 9-player 16-draw this
  is the common case; bake it into the fixed template.
- **8b corrections (deferred with 8b):** repoint to `rc_race_drivers.placement` /
  `standingsForRace()` (not `rc_drivers`); key on driver_id (S2/S3).
- **8a corrections (deferred with 8a):** pools need NET-NEW pool-aware standings
  code (existing `getStandings` is tournament-wide, no pool/loss column, join
  order load-bearing; S4).
- **S5:** next migration is **`0009_*`**; both `matches`-backed formats (Smash,
  board game) need a `games` row (`game_id` NOT NULL, format CHECK `1v1/ffa/team`
  → Smash=`1v1`); RC cup needs none.
- **Notes:** grand-finals reset deferred but state it as a shown rule + pre-allocate
  the node (O1); same-pair double ELO update is intended, not a bug (O2); mid-event
  roster change unsupported — admin re-seeds before any result (O3).

--- original plan below (8b/8a details now lower priority) ---

## 1. Concrete purpose (this is a real event)

EloUp's primary purpose is a **bachelor party** with THREE tournaments. Formats
locked by the user (2026-07-31), **9–16 players each**:

| # | Tournament | Format | Notes |
|---|---|---|---|
| 🎮 | Smash Bros | **Double elimination** | Winners + losers bracket; the flagship + hardest build |
| 🏎️ | RC truck cup | **Points series** | Points by finish across races → cup standings; layers on the EXISTING RC racing module |
| 🎲 | Board game | **Round robin** | Everyone plays everyone; rank by wins |

This is NOT a general-purpose everything-engine — build exactly these three,
MVP-first, mobile-usable for a phone at a party.

## 2. Shared decisions

- **`tournaments.format`** (existing nullable TEXT column) becomes the
  discriminator: `'double_elim' | 'points_series' | 'round_robin'`.
- **ELO interaction (resolves Q-TOURN-2) — PROPOSED DEFAULT: shared ELO.**
  Tournament matches create real `matches` rows → normal confirm + per-game +
  overall ELO; the tournament layer adds bracket/standings STRUCTURE on top. No
  isolated per-tournament pool (simpler; and cross-party ELO is the fun part).
  **User: confirm or override** — this is the one open default.
- **Seeding (9–16):** default seed by current overall ELO, with manual
  drag/reorder override by a tournament admin. Byes go to the top seeds.
- **Permissions:** tournament admins (existing `tournament_admins`) build/seed/
  advance; members view. Reuses M5.
- **Mobile UI principle:** a rendered bracket TREE is too wide for 390px. MVP =
  round-by-round **match LISTS** ("Winners R1", "Losers R2", "Grand Finals";
  standings tables for cup/round-robin). The visual connected tree is a
  **projection-surface / later** concern (ties to the deferred 1080p view).

## 3. Per-format design

### 8c · Double elimination (Smash) — the hard one
- **Fixed-template approach (key simplification):** generating a double-elim
  bracket for arbitrary N is complex (losers-bracket routing depends on winners
  rounds). Instead use a **fixed power-of-2 draw** — 16-slot for 9–16 players
  (or 8-slot for ≤8) — a known, precomputed structure. Seed 9–15 players + fill
  the rest as **byes**; top seeds get the byes. This is how bracket software does
  it and makes generation tractable + testable.
- **Data model:** `bracket_matches(id, tournament_id, bracket TEXT
  ['winners'|'losers'|'grand'], round INT, position INT, p1_source, p2_source,
  match_id NULL → real matches row, winner_to_id, winner_to_slot, loser_to_id,
  loser_to_slot, winner_player_id NULL, loser_player_id NULL)`. `p1/p2_source`
  is either a seed (initial) or "winner/loser of bracket_match X".
- **Advancement:** on the underlying match's confirm, fill winner → its
  `winner_to` slot, loser → its `loser_to` slot (or eliminated). Auto-propagate
  byes at generation.
- **Reporting a result:** a bracket slot with both entrants known → "report
  result" creates a real `matches` row (game = Smash, tournament_id set) → normal
  confirm → advancement fires. (Or admin reports directly.)
- **Grand finals bracket reset** (losers-bracket winner must beat winners-bracket
  winner twice): support, but MAY defer the reset game to a should-fix — confirm
  scope in review.

### 8b · Points series (RC cup) — reuse RC racing
- **Link races to the cup:** new `tournament_races(tournament_id, rc_race_id,
  round_label)` (many races per cup). Reuses `rc_races`/`rc_drivers`/`rc_laps`
  wholesale.
- **Points scheme:** points by finishing position, stored per-tournament
  (`tournaments.points_scheme` JSON, default e.g. F1-style
  `[25,18,15,12,10,8,6,4,2,1]`). Admin can edit.
- **Standings:** per driver, Σ points across the cup's races by finish position;
  ranked table. Computed on read. Ties broken by wins then best finish.
- **Driver↔player:** RC drivers already optionally link to Discord players
  (`DriverPlayerLink`); the cup standings key on driver (or linked player).

### 8a · Round robin (board game) — least new work
- **Schedule generation:** an admin action generates all N-choose-2 pairings as
  `matches` rows (game = the board game, tournament_id set, a `round`/`pairing`
  tag for display). Standings = wins/losses aggregated from confirmed matches
  (extends the existing `TournamentStandings` / M5 standings).
- **⚠️ Match-count blowup:** round-robin at 16 players = **120 matches** —
  impractical for one party. Design MUST address: options are (a) cap field size
  / warn, (b) **group stage** (split into pools of ~4–5, round-robin within pool,
  optional playoff), (c) accept it if the board-game field is realistically
  small. **Decide in review** — likely pools for >~8.

## 4. Suggested build sequence

Each is its own sub-task doc + review. Recommended order = build-simplicity
first (quick wins), flagship last:

1. **8a round-robin** (board game) — mostly schedule-gen + standings on existing
   match/ELO plumbing. Smallest new surface. *(Confirm the pools decision.)*
2. **8b points-series** (RC cup) — RC link + points scheme + standings. Medium;
   reuses the whole racing module.
3. **8c double-elim** (Smash) — bracket generation (fixed 16-draw), advancement,
   reporting UI. The big one; do it with the most runway.

**Alternative:** if Smash is the headline and must exist first, flip to 8c-first
— but accept the longest single build up front. *(User preference welcome.)*

## 5. Open questions for review / user

- **Q-M8-1 (user):** confirm **shared ELO** (§2) vs. isolated per-tournament pool.
- **Q-M8-2 (user):** round-robin **pools** for larger board-game fields, or cap?
- **Q-M8-3:** double-elim **grand-finals bracket reset** in v1 or deferred?
- **Q-M8-4:** build order — simplicity-first (8a→8b→8c) or Smash-first?
- **Q-M8-5:** does the RC cup standings key on **driver** or **linked player**?

## 6. Symbols / scope

New `tournaments` structure touches the `app` DB layer (new migrations for
`bracket_matches`, `tournament_races`, points scheme). Likely a new/updated
`tournaments` symbol property + `docs/tournaments.md` update + `align.py lock`.
New migrations follow the existing `NNNN_name.sql` versioned pattern. No auth/
deployment change.

## 7. Review gate

Edits will touch `eloup-web/` (schema + UI). This umbrella needs an independent
review of the plan; then each sub-part (8a/8b/8c) gets its own task doc +
review + implementation. Reviewer: focus on the double-elim data model (§8c),
the round-robin blowup (§8a), and whether the fixed-template bracket approach is
sound.
