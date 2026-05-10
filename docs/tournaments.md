# Tournaments

## Shape

A tournament is a named grouping of matches with at least one delegated admin. The **role** (`tournament_admin`) and the schema for membership and per-tournament admin delegation are committed; the bracketing rules are not.

## Schema (committed)

- `tournaments(id, name, slug, owner_id, format, invite_token, created_at, ends_at NULL)`
- `tournament_admins(tournament_id, player_id)` — the owner is implicitly an admin; additional admins are added here.
- `tournament_members(tournament_id, player_id, joined_at)` — explicit membership; matches inside the tournament can only be entered by members.

## Open questions (TBD, not safe to implement past M5 without answers)

- **Q-TOURN-1.** Bracketed event (single elim / double elim / round robin / Swiss) versus a flat named group of matches. The `format` column exists; the value set does not.
- **Q-TOURN-2.** Whether tournament results write into the same per-game ELO pool as casual matches, or run an isolated pool that resets per tournament.
- **Q-TOURN-3.** Invite-link semantics: shared link / per-invitee link / approval-gated.
- **Q-TOURN-4.** Whether a tournament admin can demote or remove the original creator.

Until these answers exist, the implementer should not invent defaults; tournament UI and bracket-progression code is gated on M5.
