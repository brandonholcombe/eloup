# Review — H12 Guest tournament entrants

## Reviewer: claude-opus-4.8-h12-reviewer

Task under review: `h12-guest-tournament-entrants.md`
(`Agents/TODO/Active/h12-guest-tournament-entrants.md`, Author
`claude-opus-4.8-h12-implementer`).

## Verdict: Approve-with-changes

The core design — a guest is a `players` row with a synthetic
`discord_id` and `is_guest = 1`, added as a `tournament_member` — is
**correct and safe**. The synthetic id is collision-proof against real
Discord auth, and the guest flows identically through seeding, bracket
matches, and ELO because every downstream query keys on `players.id`.
No blocking defects. Four should-fixes below, two of which the doc
already anticipates (orphan cleanup, migrate test). Counts: **0 blocking,
4 should-fix, 3 optional.**

---

## #1 Synthetic `discord_id` safety — CONFIRMED SAFE (most important)

Collision-safe, verified against the real auth path:

- `lib/auth.ts` `signIn` reads `profile.id` (the Discord snowflake) and
  hands it to `bootstrapPlayer`, which calls
  `findPlayerByDiscordId(db, profile.id)` (`lib/db/players.ts:28`,
  `lib/db/queries.ts:29` — `WHERE discord_id = ?`). Discord snowflakes
  are all-numeric strings; `guest:<uuid>` contains a colon and hex, so it
  can **never** equal a snowflake. A guest can therefore never be matched
  by a real login, and never logged into.
- The bootstrap-admin promotion checks `profile.id === bootstrapAdminDiscordId`
  (`players.ts:52`, `:67`) — also a numeric snowflake, so a guest can
  never be auto-promoted.
- `discord_id` is `NOT NULL UNIQUE` (`0001_init.sql:8`). The UNIQUE
  constraint *helps* here: two guests get distinct `randomUUID()`s, so no
  insert collision, and the constraint guarantees it.
- The `jwt` / `session` callbacks (`auth.ts:39-61`) only run for a real
  OAuth profile, which a guest never has, so nothing keys a session on a
  guest's non-numeric `discord_id`.

The synthetic-id hack is **acceptable and lower-risk than the nullable
alternative**. Making `discord_id` nullable would require a SQLite table
rebuild (12-column recreate + data copy) and would loosen the UNIQUE
guarantee that currently makes guests trivially safe. Keep the synthetic
id. (Optional: prefix documented as `guest:` — fine; any non-numeric
sentinel works.)

## #2 `is_guest` migration + INSERT completeness — CORRECT

`ALTER TABLE players ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0` is
valid SQLite and the right minimal change (NOT NULL is legal on ADD
COLUMN because of the DEFAULT). Verified against `0001_init.sql:6-17`, a
guest INSERT must supply exactly: `id`, `discord_id` (synthetic),
`discord_handle`, `display_name`. Everything else is safe to omit:
`email` / `avatar_url` are nullable; `email_verified` defaults 0; `role`
defaults `'user'` (explicit `'user'` in the doc is fine and satisfies the
CHECK); `created_at` defaults. No UNIQUE/CHECK on `display_name` or
`discord_handle`, so duplicate guest names are fine — doc claim confirmed.

## #3 Guest orphans on tournament delete — REAL problem, should-fix

`deleteTournament` (`admin-delete.ts:78-116`) reverses ELO, nulls
`last_match_id`, and deletes bets → bracket_matches → match_participants →
matches → admins → members → tournament. It **never deletes `players`
rows, nor the `ratings` / `overall_ratings` rows.** So after a delete:

- The guest `players` row persists forever.
- Its `overall_ratings` row persists. ELO reversal only *subtracts the
  delta* (`MAX(0, current_rating - delta)`, `admin-delete.ts:34`) — it
  does not delete the row. A guest who played only in this tournament
  lands back near 1200 and **stays on the global overall leaderboard
  permanently** (`overallLeaderboard`, `queries.ts:152` JOINs `players`
  with no `is_guest` filter). Its `ratings` row likewise persists with
  `games_played` decremented (possibly to 0).

Not an FK/corruption bug — the rows are internally consistent — but it is
real leaderboard pollution: every deleted tournament leaves dead guest
names sitting at ~1200. For a party app this accumulates visibly.

**Correction:** in `deleteTournament`, after deleting this tournament's
`match_participants` and `tournament_members`, also purge guests that
belong *only* to this tournament. FK-safe ordering (foreign_keys = ON):

1. Compute the guest set:
   `SELECT player_id FROM (the just-removed members)` filtered to
   `is_guest = 1` AND not present in any *other* tournament's
   `tournament_members` (defensive — no UI adds a guest to two
   tournaments, but nothing enforces single-tournament, so guard it).
2. For that set, delete `overall_ratings`, then `ratings`
   (both FK `players`), then the `players` rows. Their
   `match_participants` are already gone with the tournament's matches,
   and `last_match_id` refs were nulled, so no dangling FK. Do this
   *before* the final `DELETE FROM tournaments` is irrelevant, but it
   must run *after* `DELETE FROM tournament_members` (so the guest is no
   longer a member) and inside the same transaction.

Same orphan applies to `removeMember` (`lib/tournaments.ts:161`) — it
deletes only from `tournament_admins` / `tournament_members`, leaving a
kicked guest's `players` row behind. Since the non-goals say "rename =
delete + re-add," a guest kicked to rename will orphan every time. At
minimum call this out; ideally `removeMember` (or a dedicated
`removeGuest`) purges an `is_guest` player with no remaining membership
and no `match_participants`. Guarding on "no match_participants" avoids
FK failure if the guest already has a played bracket result — in that
case leave the row (their matches are authoritative until the tournament
is deleted).

## #3b Player-search leak — should-fix (doc does not mention it)

`searchPlayers` (`queries.ts:292`) does a `LIKE` over **all** players
with no `is_guest` filter. It backs `/api/players/search`
(`app/api/players/search/route.ts:43`), consumed by `DriverPlayerLink`
(`components/DriverPlayerLink.tsx:53`) for linking an RC transponder to a
player. Guests will surface there, letting an admin link real RC race
results to a throwaway bracket-only guest identity — almost certainly not
desired. **Correction:** add `AND is_guest = 0` to `searchPlayers`
(scope it to the search helper so leaderboards/members are unaffected).
The route is already admin-gated (`canEditRace`), so this is a
correctness/cleanliness fix, not a security hole.

## #4 Bracket / ELO integration — no breakage

- `seedMembersByElo` (`bracket.ts:49`) and `shuffledMembers`
  (`bracket.ts:183`) select `tournament_members.player_id` — a guest is
  seeded identically to a real player, ordered by `COALESCE(overall,
  1200)` (new guest sorts at 1200). ✓
- `recordBracketResult` (`bracket.ts:226`) inserts a real `matches` row +
  two `match_participants` keyed on `player_id` (FK → `players.id`,
  which the guest satisfies), then `applyEloUpdate` upserts `ratings` /
  `overall_ratings` for the guest (`match.ts:164`, `:176`). No login or
  session is required for a *participant*; `created_by` is the admin. ✓
- Nothing in match creation, confirm, or advancement reads a
  participant's `discord_id` or requires a session for the guest. ✓

## #5 Scope / UX — sound, one gap

- Permission gate `isTournamentAdmin` (`permissions.ts:89`) is the right
  choice and matches every other member mutation
  (`members/[playerId]/route.ts:25`, admins, invite). ✓
- "Add guests anytime, regenerate to include" is consistent with
  `reseedBracket` (`bracket.ts:162`), which is allowed only while no node
  is `status='done'`. The UI note to add-before-generate is accurate. ✓
- **Gap (should-fix for the badge to work):** `listMembers`
  (`lib/tournaments.ts:124`) does not select `is_guest`, and
  `TournamentMemberRow` has no such field. The "guest badge on
  `MemberRow`" cannot render without adding `p.is_guest` to that SELECT
  and the row type. Call this out as required plumbing, not an
  afterthought.

## Optional

- **Global leaderboard exclusion:** doc defers `AND is_guest = 0` on
  `overallLeaderboard` / `leaderboardForGame`. Acceptable for v1 as
  stated, *provided* #3 cleanup lands — otherwise deleted-tournament
  guests linger on the board and the "acceptable for a party" framing
  stops holding. If #3 is deferred too, reconsider excluding guests from
  the global board now.
- **Migrate test (`tests/unit/migrate.test.ts:53`):** the doc says
  "migrate test +0012 (column check)" but understates it — line 53 is an
  **exact array** assertion `toEqual([1,...,11])`, so adding 0012 *fails*
  the existing test until the array is extended to include `12`. Add the
  `is_guest` column assertion (`PRAGMA table_info(players)`, `notnull=1`,
  `dflt_value='0'`) alongside extending the version array. This is
  mechanical but must be explicit so it isn't missed.
- **Name validation:** trim to reject whitespace-only and cap length
  (the doc says "sane length" — pin a number, e.g. 1–40 chars, and 400 on
  violation, matching the API contract).

## Summary of required changes before merge

1. (#3) `deleteTournament` purges single-tournament `is_guest` players +
   their `ratings`/`overall_ratings`, FK-safe, in-transaction; note/guard
   the same for `removeMember`.
2. (#3b) `searchPlayers` adds `AND is_guest = 0`.
3. (#5) `listMembers` selects `p.is_guest`; extend `TournamentMemberRow`.
4. (test) Extend `migrate.test.ts:53` version array to include 12 and
   assert the `is_guest` column.

Design is approved on substance; ship once the four should-fixes land.
