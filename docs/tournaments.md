# Tournaments

## Shape

A tournament is a named grouping of matches with at least one delegated admin. Tournaments are not bracketed events in M5 — they are flat named groups whose match results stack into the same per-game ELO pool casual matches use. The `tournament_admin` role is per-tournament and derived from the `tournament_admins` table, not from the `players.role` column.

## Schema (committed in 0001_init.sql + 0002 indexes)

- `tournaments(id, name, slug UNIQUE, owner_id, format, invite_token, created_at, ends_at NULL)` — `format` is the literal string `"named_group"` on every M5 row. `invite_token` is the single-shared-link storage (rotation = UPDATE, revoke = SET NULL).
- `tournament_admins(tournament_id, player_id)` — the creator is implicitly an admin (row inserted at creation). Additional admins are promoted in.
- `tournament_members(tournament_id, player_id, joined_at)` — every admin is also a member; non-admin members exist for non-admin participation.
- `matches.tournament_id` (NULL-able FK to `tournaments.id`) — populated when a match is logged inside a tournament. Confirm-match transaction is pool-agnostic; ratings update against the shared per-game ELO regardless.
- Indexes (0002): partial on `tournaments.invite_token`, on `tournament_members.player_id`, partial on `matches(tournament_id, status)`.

## Resolved Q-TOURN-1..4 (M5, 2026-05-15)

- **Q-TOURN-1 → `format = "named_group"`.** No bracket UI in M5. Bracketed formats (single-elim, round-robin, swiss) deferred to a later milestone — the seed→advance UI is a separate lift that the party-app use case does not require.
- **Q-TOURN-2 → `rating_pool = "shared"`.** Tournament-scoped matches write to the same `ratings` / `overall_ratings` tables as casual matches. The M4 confirm-match transaction is unchanged. Tournament standings express W/L scoped to that tournament — they are NOT a separate ELO universe.
- **Q-TOURN-3 → `invite_model = "single_shared_link"`.** One token per tournament at a time, stored in `tournaments.invite_token`. Rotation generates a fresh URL-safe 24-character token (replacing the prior one); revocation sets the column to NULL so the partial index never matches a stale token.
- **Q-TOURN-4 → `creator_demotable = false`.** Other admins can promote and demote each other; only a `global_admin` can demote the creator from `tournament_admins`. Removing the creator from `tournament_members` is rejected outright.

## Cross-cutting

- `players.role` is NOT mutated by tournament promote/demote. The CHECK constraint still permits `tournament_admin` for forward-compat, but M5 never writes that value. Permission helpers (`isTournamentAdmin`) read `tournament_admins` directly.
- Permission gates: `isTournamentMember`, `isTournamentAdmin` (global_admin always passes), `canEditMatch` (creator OR tournament admin of the scoped tournament OR global_admin).

## Standings algorithm

Per-tournament standings are a live SQL query in `lib/tournament-standings.ts`. Members are ranked by:

1. `wins DESC` — placement-1 finishes inside this tournament's confirmed matches.
2. Has-played-flag — members with at least one tournament match rank above zero-match members on a wins tie. Resolves the "0w/0p vs 0w/1p" tiebreak in favor of the participant.
3. `matches_played ASC` among players who have played — sports-style "fewer total games at the same win count = better record."
4. `overall_rating DESC` — global overall ELO as final numeric tiebreak.
5. `display_name ASC` — deterministic order for screenshots.

Join order matters: the SQL anchors `matches m` as the outer LEFT JOIN (filtered to the tournament + status='confirmed') and joins `match_participants` *through* it. The intuitive "join mp first" pattern leaks casual matches into the W/L counts (verified during M5 review).

## Invite lifecycle

- `issueInvite(db, tournamentId)` — generates a 24-character base64url token, writes it to the row, returns it.
- `consumeInvite(db, token, playerId)` — partial-index lookup; on hit, INSERT-OR-IGNORE into `tournament_members`. Returns a tagged union: `{status: 'joined' | 'already_member', tournament}` or `{status: 'invalid_token'}` (revoked/unknown). The `/tournaments/join/[token]` route handler maps `'invalid_token'` to HTTP 410 and the join cases to a 303 redirect to `/tournaments/[slug]`.
- `revokeInvite(db, tournamentId)` — sets `invite_token = NULL`. Rotating = re-issuing.

## Double-elimination brackets (M8c, 2026-08-01)

For the bachelor party's Smash Bros event. `tournaments.format = 'double_elim'`
opts a tournament into a bracket (default stays the M5 named-group).

- **Engine** (`lib/bracket/engine.ts`) — pure, in-memory, no DB, proven by golden
  invariant tests (`tests/unit/bracket-engine.test.ts`): fixed power-of-2 draw
  (16 for 9-16 players), standard seed order, WB/LB/GF routing. The winners-final
  loser drops to the losers final (LR6); the WB→LB drop cross alternates
  reverse/straight per round to avoid immediate rematches. A void-aware
  fixed-point resolver auto-advances byes/walkovers and recurses.
- **Persistence** (`0009_bracket.sql`, `lib/db/bracket.ts`) — `bracket_matches`
  mirrors the engine node. `createBracket` seeds by overall ELO. Each played
  result is **admin-authoritative**: `recordBracketResult` creates a real Smash
  (`game_smash`, 1v1) `matches` row (winner placement 1) and runs the shared ELO
  update in one transaction, then advances. `recordWalkover` advances a no-show
  with no match/ELO.
- **UI** — `/tournaments/[slug]` renders round-by-round match lists (not a tree);
  admins generate the bracket and report winners. Single grand final (no bracket
  reset in v1); mid-event roster changes unsupported (regenerate before any
  result). RC cup (points series) + board-game round-robin (8b/8a) are run by
  hand for the party.

## Out of scope (M5)

- Bracket progression, seeding, bye handling.
- Per-invitee tokens, expiry, max-uses, join-requests — the single-column model gates these on a future migration.
- Tournament archival via `ends_at`.
- Public discovery of tournaments — every join goes through the invite link.
