# Architecture

## Stack

- **Framework:** Next.js (App Router) — single deployable surface for UI, server actions, and API routes.
- **Runtime:** Node 20.
- **Database:** SQLite via `better-sqlite3`. The DB file is the source of truth; backups are file copies.
- **Orchestrator:** Kubernetes. The app runs as a single-replica StatefulSet so the SQLite PVC binding is stable across pod recreates.
- **GitOps:** ArgoCD reconciles from the canonical Git remote (GitHub). Manifests are mirrored to Gitea (`haxley.luckyenough.us`) but ArgoCD does not pull from Gitea.
- **Image registry:** DockerHub (`bholcombe/eloup-*`). Images are AMD64 only (`linux/amd64`); the Pi heart-rate service, when added, will be ARM64.

## Why this stack

Party-scale dataset (tens of players, thousands of results over the lifetime of the app) does not justify a separate database server. SQLite gives us transactions, FTS if we ever want it, and trivial backup/restore. Co-locating UI and server logic in one Next.js process keeps the deploy story to "one container, one volume."

Kubernetes + ArgoCD is the org pattern (see captain-sonar, shine on the same cluster); going against it would mean re-inventing platform concerns that already work. Single-replica StatefulSet rather than Deployment because SQLite needs sole ownership of the file, not rolling-update overlap.

## Data model (initial sketch)

- `players` — id, discord_id (unique), discord_handle, display_name, email, email_verified, avatar_url, role, created_at
- `games` — id, name, slug, default_k, format (1v1|ffa|team), min_participants, max_participants, created_at
- `matches` — id, game_id, tournament_id (nullable), status (scheduled|pending|confirmed|disputed|cancelled), scheduled_at, started_at, ended_at, created_by, created_at
- `match_participants` — match_id, player_id, team_label, placement, score, rating_before, rating_delta, confirmed_at
- `ratings` — (player_id, game_id) → current_rating, games_played, last_match_id
- `overall_ratings` — player_id → current_rating, escrowed_elo, last_match_id (CHECK current_rating ≥ 0)
- `tournaments` / `tournament_admins` / `tournament_members` — see `tournaments.md`
- `bets` — see `betting.md`

`ratings` and `overall_ratings` are denormalized for read speed; both are rebuildable from the `matches` log.
