# H12 — Guest tournament entrants (manual name, no Discord)

## Author: claude-opus-4.8-h12-implementer
## Status: Complete

## Outcome (2026-08-07) — implemented + verified live

Migration `0012_players_is_guest.sql`; `addGuestMember` + `purgeOrphanGuests` in
`lib/tournaments.ts` (+ `is_guest` on `TournamentMemberRow`/`listMembers` and
`PlayerRow`); purge wired into `deleteTournament` (admin-delete.ts) + `removeMember`;
`searchPlayers` excludes guests; `POST /api/tournaments/[slug]/guests`;
`AddGuestButton` + guest badge in `MemberRow`. All 4 reviewer should-fixes folded.
vitest 367→375 (8-test `guest-entrants.test.ts`); typecheck/lint/build green;
`docs/tournaments.md` + `align.py lock` updated (alignment OK). Live harness on
:3100: created "Table Bob" (is_guest=1), 400 on empty/41-char, 401 anon, GUEST
badge renders + appears in standings, excluded from player search, and removing
the member purged the orphan player row.

## Reviewer findings folded (2026-08-07)

Review at `Agents/Review-reports/h12-guest-tournament-entrants-review.md`:
**Approve-with-changes** — 0 blocking, 4 should-fix. Synthetic `guest:<uuid>`
confirmed collision-safe (snowflakes are numeric; NOT NULL UNIQUE reinforces it);
bracket/ELO integration clean. Folded:
- **S1 (orphans — the real one):** `deleteTournament` reverses ELO but leaves the
  guest's `players` + `overall_ratings`/`ratings` rows → they pollute the global
  leaderboard at ~1200 forever. Add a **`purgeOrphanGuests(db, playerIds)`**: for
  each `is_guest=1` player with NO remaining `tournament_members` AND NO
  `match_participants`, delete `overall_ratings` → `ratings` → `players`
  (FK-safe, in-txn). Call it in `deleteTournament` (capture the tournament's guest
  member ids BEFORE deleting members/matches, purge after) and on `removeMember`
  (purge just the removed id — no-op unless it's an orphan guest).
- **S2:** `searchPlayers` must add `AND is_guest = 0` so guests don't leak into RC
  driver-linking / player search.
- **S3:** `listMembers` must `SELECT ... is_guest` (+ row type) so the guest badge
  can render.
- **S4:** `migrate.test.ts` is an exact `toEqual([1..11])` → extend to `12` + add
  the `is_guest` column check.

## Scope (user, 2026-08-07)

Some Smash players won't have Discord. An admin needs to **add a participant by
name** so they can be in the bracket. Applies to any tournament (member-based),
demonstrated for Smash.

## Design — a guest is a player who can't log in

Reuse the entire existing pipeline (members → bracket → matches → ELO) by making
a guest a normal `players` row that simply has no real Discord identity:

- **Migration `0012_players_is_guest.sql`:** `ALTER TABLE players ADD COLUMN
  is_guest INTEGER NOT NULL DEFAULT 0`.
- **Synthetic id:** `players.discord_id` is `NOT NULL UNIQUE`, so a guest gets a
  synthetic `discord_id = 'guest:' + randomUUID()`. Safe: auth looks players up by
  the real Discord snowflake (`findPlayerByDiscordId`), which is numeric and can
  never equal `guest:<uuid>` — so a guest can never be logged into, and there's no
  collision. `discord_handle` + `display_name` = the entered name; `is_guest = 1`;
  `role = 'user'`.
- **`addGuestMember(db, tournamentId, name)`** (one txn): trim/validate name
  (non-empty, sane length); create the guest player; add to `tournament_members`;
  return the player. Duplicate display names are fine (distinct synthetic ids).

## API + UI

- **API:** `POST /api/tournaments/[slug]/guests` `{ name }` — gated
  `isTournamentAdmin`; 400 on empty name.
- **UI (tournament detail, Members section, admin):** an "Add guest" inline
  input + button (like `CreateCupButton`). Shows a small **guest** badge on guest
  members (`MemberRow`), and optionally in the bracket card.
- **Flow note (surface in UI):** the bracket seeds from members at generate/shuffle
  time — add guests BEFORE generating (or add + reshuffle before the first result).
  A guest added after the bracket is locked won't appear until it's regenerated.

## Behavior notes (for the reviewer + docs)

- **ELO / leaderboards:** a guest is a real player, so bracket matches move their
  per-game + overall ELO and they appear on leaderboards (and the member-filtered
  leaderboard). Acceptable for a party; NOT excluding guests from the global board
  in v1 (could add `AND is_guest = 0` later if wanted — call out, don't build).
- **Delete:** `deleteTournament` (H10) already removes members + reverses ELO;
  guest player ROWS are left (harmless, orphaned) unless we also delete guest
  players — decide in review whether to clean up guest players on tournament
  delete (they're single-tournament by nature). Likely a should-fix.
- **Permissions:** tournament_admin / global_admin only (reuse `isTournamentAdmin`).

## Testing / verification
- Integration: `addGuestMember` creates an `is_guest=1` player with a `guest:`
  discord_id + a member row; the guest can be seeded into a bracket
  (`createBracket` from members incl. the guest) and win a match (ELO moves).
  Auth lookup by a numeric snowflake never returns a guest.
- `pnpm lint`/`typecheck`/`build`/`test` green; migrate test +0012 (column check).
- Verify live in the harness: add a guest to Summer Cup, see them in Members with
  a badge, generate/shuffle → guest is a bracket entrant.
- No symbol change expected; note guests in `docs/tournaments.md`/`app.md` schema
  prose + `align.py lock` if a doc changes.

## Non-goals
Converting a guest to a real Discord user later; guest self-service; excluding
guests from the global leaderboard; editing/renaming a guest (delete + re-add).

## Review gate
Edits `eloup-web/` (migration + lib + API + UI). Needs an independent review by a
different agent than `## Author:`, referencing `h12-guest-tournament-entrants.md`,
before implementation — focus on the synthetic-`discord_id`/auth non-collision,
the `is_guest` migration, and whether guest player rows should be cleaned up on
tournament delete.
