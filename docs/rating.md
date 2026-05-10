# Rating

## Algorithm

Standard ELO. Per-game ratings are the source of truth; cross-game aggregates are a derived view.

## Defaults

- **Starting rating:** 1200
- **K-factor:** 32 (per game, overridable in the `games` row)

## Multi-player matches

For 1v1 games, ELO applies directly. For >2-player matches we compute pairwise ELO updates over every (winner, loser) pair from the final placement, then average the deltas per player. K is divided by `(n − 1)` so a single match is not weighted as N pairwise matches.

## Why per-game and not global

A player who is great at chess and terrible at darts should have a chess rating that reflects chess, not a blended number that's wrong for both games. The aggregate view exists for the leaderboard but does not feed back into per-game updates.
