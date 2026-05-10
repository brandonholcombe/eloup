# Auth

## Model

Per-player login. Every player has an account; sessions are required for any state-changing action.

## Result entry flow

1. One participant opens "Log result," picks the game, picks the other participant(s), enters the result.
2. The match is recorded with `status=pending` and **does not affect ratings yet**.
3. Each other participant gets a pending-confirmation card on their dashboard.
4. Once **all** participants have confirmed, the match transitions to `confirmed` and rating deltas are applied.
5. Any participant can mark a pending match `disputed` instead of confirming; disputed matches need an admin to resolve.

## Why confirmation

Single-entry without confirmation degrades into "whoever logs first writes history." Confirmation by all participants is the cheapest way to keep the leaderboard honest at party scale.
