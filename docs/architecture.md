# Architecture

## Stack

- **Framework:** Next.js (App Router) — single deployable surface for UI, server actions, and API routes.
- **Runtime:** Node 20.
- **Database:** SQLite via `better-sqlite3`. The DB file is the source of truth; backups are file copies.

## Why this stack

Party-scale dataset (tens of players, thousands of results over the lifetime of the app) does not justify a separate database server. SQLite gives us transactions, FTS if we ever want it, and trivial backup/restore. Co-locating UI and server logic in one Next.js process keeps the deploy story to "one container, one volume."

## Data model (initial sketch)

- `players` — id, display_name, password_hash, created_at
- `games` — id, name, slug, default_k, created_at
- `matches` — id, game_id, played_at, status (pending|confirmed|disputed)
- `match_participants` — match_id, player_id, score_or_placement, rating_before, rating_delta, confirmed_at
- `ratings` — (player_id, game_id) → current_rating, games_played, last_match_id

`ratings` is denormalized for read speed; it is rebuildable from the `matches` log.
