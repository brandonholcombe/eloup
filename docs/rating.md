# Rating

## Algorithm

Standard ELO. Per-(player, game) ratings are the source of truth.

## Defaults

- **Starting rating:** 1200
- **K-factor:** 32 (per game, overridable in the `games` row)

## Multi-player matches

For 1v1 games, ELO applies directly. For >2-player matches we compute pairwise ELO updates over every (winner, loser) pair from the final placement, then average the deltas per player. K is divided by `(n − 1)` so a single match is not weighted as N pairwise matches.

Team-format ELO (up to 8v8) is unresolved (Q-RATE-2); proposed default is "each member gets the same delta computed from team-average ratings" but not yet committed.

## Overall rating

Overall rating is its own **independent ELO**, not a derived view. Every match runs two ELO updates: one against the players' per-game ratings, one against their overall ratings. Both default to `K=32` and `starting=1200`. Overall ELO is a real, settable column because the betting feature mutates it directly.

## Floor

Overall ELO **cannot go below 0**. A DB-level CHECK constraint on `overall_ratings.current_rating ≥ 0` enforces this. Bet losses and rare match-driven updates that would push a low-rated player below 0 are clamped at 0 ("broke"); a player at 0 cannot place new bets.

## Why per-game and not global

A player who is great at chess and terrible at darts should have a chess rating that reflects chess, not a blended number that's wrong for both games. Per-game ratings are the rating signal; overall ELO is a separate, party-wide "wallet" that betting can spend against.
