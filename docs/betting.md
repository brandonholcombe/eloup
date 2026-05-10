# Betting

A hidden, opt-in feature that lets authenticated users wager their **overall ELO** on the outcome of a `scheduled` or `confirmed` match.

## Currency, escrow, and floor

- **Currency:** `overall_ratings.current_rating`. There is no separate token, no per-bet "play money" — bets move the same number that drives the overall leaderboard.
- **Escrow at placement:** placing a bet immediately debits `current_rating` by the wager amount and credits an `escrowed_elo` field on the same row. This is a single transaction with `BEGIN IMMEDIATE` (SQLite) so two simultaneous placements cannot oversell the same balance.
- **Floor:** overall ELO cannot go below 0 (DB CHECK constraint). A player whose `current_rating` reaches 0 cannot place new bets. This is the only thing standing between a losing streak and a negative balance.

## Cap rule

At placement, the wager ceiling is

```
cap = min(
    max(|per_game_rating_delta_potential|) over all participants,
    bettor.overall_ratings.current_rating
)
```

The first half is the largest per-game rating delta the match would create for any participant, computed against the bettor's own per-game rating where applicable. The second half ensures a bettor cannot place more than they have available after existing escrows.

## Settlement

Bets settle atomically with the match's `pending → confirmed` transition. Winners receive their escrow back plus a payout sourced from the loser pool; losers forfeit their escrow into that pool. A `disputed` or `cancelled` match returns escrow 1:1 to every bettor and voids the bet.

Bets are **never** placed against `pending` matches — the betting window is closed the moment a match starts (`status` transitions away from `scheduled`).

## Hidden by default

The UI renders no betting controls until the user performs a reveal gesture. The reveal must be touch-native — keyboard-only mechanisms (Konami codes) are off the table because the primary device is a phone with no keyboard. The exact gesture is Q-BET-1 (TBD).

## Open questions

- **Q-BET-1.** Reveal mechanism (long-press logo / corner-tap / URL flag).
- **Q-BET-5.** Whether participants can bet on themselves — needs a DB constraint, not just UI gating, since the feature is deliberately obscured.
- **Q-BET-6.** Whether bets are public, admin-only, or fully private until settlement.

The betting code path must not ship past M6 with these unanswered.
