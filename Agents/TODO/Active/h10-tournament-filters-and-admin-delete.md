# H10 — Tournament filters (leaderboard + matches) + admin delete (ELO-reversing)

## Author: claude-opus-4.8-h10-implementer
## Status: Complete

## Outcome (2026-08-07) — SHIPPED, verified live

- **A.** Leaderboard tournament filter (`TournamentFilter`, `?tournament=`),
  member-restricted queries + rank respecting the filter (S2). Verified: all 14 →
  Summer Cup 13 members.
- **B.** Matches filter (viewer's memberships).
- **C.** `lib/db/admin-delete.ts`: `deleteMatch`/`deleteTournament` reverse ELO
  (per-game + overall via new 0011 `overall_rating_delta`), B1 `last_match_id`
  null-outs, bets pre-delete (S1), bracket-linked guard, FK-safe cascade. 5
  integration tests (exact reversal, cascade, guard). API `DELETE
  /api/matches/[id]` + `/api/tournaments/[slug]`; UI delete buttons (match detail,
  tournament danger zone). Verified live: delete m_conf → Brandon 1240→1225 exact.
- migrate test → 11 + column check (S5). vitest 357 → 362.

## Reviewer findings folded (2026-08-07)

Review at `Agents/Review-reports/h10-tournament-filters-and-admin-delete-review.md`:
**Request-changes** — 1 blocking, 5 should-fix. Confirmed: only per-game delta is
stored (new `overall_rating_delta` needed); cascade order otherwise correct.
Folded:
- **B1 (critical):** `applyEloUpdate` also writes `last_match_id = matchId` onto
  `ratings` AND `overall_ratings` (both `REFERENCES matches(id)`), so
  `DELETE FROM matches` FK-violates on any confirmed match. FIX: before deleting
  matches, in the same txn, `UPDATE ratings SET last_match_id = NULL WHERE
  last_match_id IN (<deleted ids>)` and the same for `overall_ratings` (both
  nullable; do it for ALL deleted matches).
- **S1:** `bets.match_id` is NOT NULL REFERENCES matches — delete any `bets` rows
  for the match first (M6 table is empty now, so harmless + future-safe);
  `escrowed_elo` stays untouched.
- **S2:** the "your rank" filter must restrict BOTH the `higher` and `total`
  counts to members, and return `null` when the viewer isn't a member of the
  selected tournament (so the affordance hides).
- **S3:** only `status='confirmed'` reverses ELO; pending/disputed/cancelled just
  delete rows (NULL deltas — don't subtract them). A pending match is never
  bracket-linked.
- **S4:** filters resolve `slug→id`, fall back to "all" on invalid slug; matches
  `<select>` lists only the viewer's memberships.
- **S5:** migrate test version array `[1..10]` → `11` + add a
  `PRAGMA table_info(match_participants)` check for `overall_rating_delta`.

## Scope (user, 2026-08-07)

Three additions:
- **A.** Leaderboard: filter by tournament (restrict to that tournament's members).
- **B.** Matches tab: filter by tournament.
- **C.** Admins can delete tournaments and matches within them, reversing the ELO
  those matches applied.

Decisions: delete **reverses recorded deltas**; leaderboard filter **restricts to
tournament members** (same rating tabs, fewer players).

## A. Leaderboard tournament filter

- `/leaderboards` gains a **tournament `<select>`**: "All players" + each
  tournament (by name). URL param `?tournament=<slug>` alongside `?tab=`.
- When set, `overallLeaderboard` / `leaderboardForGame` restrict to
  `player_id IN (SELECT player_id FROM tournament_members WHERE tournament_id = ?)`.
  Add member-scoped query variants (or an optional `memberIds`/`tournamentId`
  param) — keep the existing join-order/ordering.
- The "your rank" affordance (UX2 2c) must respect the filter — rank among the
  filtered pool. `overallPlayerRank`/`gamePlayerRank` gain an optional member
  restriction, or compute rank within the returned filtered set.
- Leaderboards are anonymous-visible; the filter lists ALL tournaments (party
  groupings aren't secret). Note as a known choice.

## B. Matches tournament filter

- `/matches` gains a tournament `<select>` (tournaments the viewer is a member
  of). URL param `?tournament=<slug>`.
- The viewer's-matches query gains `AND m.tournament_id = ?` when set.

## C. Admin delete (the careful part)

### Migration `0011_overall_rating_delta.sql`
`match_participants` stores per-game `rating_delta` but NOT the overall delta
(verified in `lib/db/match.ts` `applyEloUpdate` — only `beforePerGame`/`dPerGame`
are persisted). Add `overall_rating_delta REAL` (nullable). Modify
`applyEloUpdate` to persist it going forward. Pre-migration rows are NULL →
reversed as 0 (documented approximation; the party's data is fresh so this is
near-total coverage).

### `deleteMatch(db, matchId)` — reverse ELO, one transaction
1. If the match is **confirmed**, for each participant reverse the stored deltas:
   - `ratings.current_rating -= rating_delta`, `games_played -= 1` (per-game).
   - `overall_ratings.current_rating = MAX(0, current_rating - COALESCE(overall_rating_delta,0))`
     (the CHECK floor at 0 must not be violated; clamp).
2. Delete `match_participants` then `matches`.
3. **Bracket-linked guard:** if a `bracket_matches.match_id` references this match,
   DISALLOW individual deletion (return an error — the bracket is authoritative;
   deleting mid-bracket would desync advancement). Fix a bracket mistake by
   deleting the whole tournament. (Un-report is out of scope.)
- Exactness note: reversing stored deltas is exact when deleting newest-first,
  approximate out of order (deltas were computed against ratings-at-the-time).
  Acceptable for a party per the user decision.

### `deleteTournament(db, tournamentId)` — cascade, one transaction
Order matters (FKs, `foreign_keys = ON`):
1. Reverse ELO for every **confirmed** match in the tournament (as above).
2. Delete `bracket_matches` (they reference `matches` via match_id).
3. Delete `match_participants` for the tournament's matches, then those `matches`.
4. Delete `tournament_admins`, `tournament_members`.
5. Delete the `tournaments` row.
(RC cups are RC-native, not tournament-linked — untouched.)

### Permissions + UI
- **global_admin** may delete any tournament/match; a **tournament_admin** may
  delete their own tournament + its matches. Reuse `isTournamentAdmin` /
  `canForceConfirmMatch`-style checks. Non-tournament casual matches → global_admin
  only.
- **Delete tournament:** a "Danger zone" button on `/tournaments/[slug]` (admin),
  `window.confirm` naming the tournament + noting ELO reversal. API `DELETE
  /api/tournaments/[slug]`.
- **Delete match:** a delete button on `/matches/[id]` (admin), confirm dialog;
  hidden/disabled for bracket-linked matches (with a note). API `DELETE
  /api/matches/[id]`.

## Testing / verification
- Unit/integration: `deleteMatch` reverses per-game + overall ratings + games_played
  to the prior values (seed → play → delete → assert ratings restored, exact for
  single match); overall floor clamp; bracket-linked deletion rejected.
  `deleteTournament` cascades (no orphan matches/participants/bracket/members) and
  reverses ELO. Leaderboard member-filter returns only members; matches filter.
- `pnpm lint`/`typecheck`/`build`/`test` green; migrate test +0011 (column + version).
- Verify live in the harness (seeded tournament + bracket): filters work; delete a
  casual match reverses ratings; delete a tournament removes everything; bracket
  match delete blocked.
- `align.py check` OK (rating symbol unaffected — reversal uses stored deltas; note
  the new column in docs/app.md schema if it tracks columns).

## Non-goals
Un-reporting a single bracket result; deleting catalog games (the `/games` entries)
— scope is tournaments + matches. Soft-delete/undo; full ELO recompute.

## Review gate
Edits `eloup-web/` (migration + lib + API + UI). Needs an independent review by a
different agent than `## Author:`, referencing this filename, before implementation
— focus on the ELO-reversal correctness (overall-delta storage, floor clamp,
order-dependence), the deleteTournament FK cascade order, and the bracket-linked
match guard.
