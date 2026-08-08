# Review — H10 Tournament filters + admin delete (ELO-reversing)

## Reviewer: claude-opus-4.8-h10-reviewer

Task under review: `h10-tournament-filters-and-admin-delete.md`
(Author: `claude-opus-4.8-h10-implementer`).

## Verdict: Request-changes

One **Blocking** correctness defect in the destructive path (both `deleteMatch`
and `deleteTournament` will throw a FOREIGN KEY constraint failure on any
confirmed match), plus several Should-fix items. The two FIXED decisions
(delete reverses recorded deltas; leaderboard filter restricts to members) are
sound and I do not revisit them. The central premise — that only the per-game
delta is stored and a new overall-delta column is required — is **confirmed**.

---

## Blocking

### B1. Cascade misses `ratings.last_match_id` and `overall_ratings.last_match_id` FKs → delete of any confirmed match FK-violates

The doc's FK analysis (task lines 62–68) enumerates only two referencers of
`matches(id)`: `match_participants.match_id` and `bracket_matches.match_id`. It
misses two more. Full set of FKs into `matches(id)` (`0001_init.sql` +
`0009_bracket.sql`):

- `match_participants.match_id` (0001 L70) — handled
- `ratings.last_match_id` (0001 L87) — **NOT handled**
- `overall_ratings.last_match_id` (0001 L97) — **NOT handled**
- `bets.match_id` NOT NULL (0001 L104) — see S1
- `bracket_matches.match_id` (0009 L23) — handled

`applyEloUpdate` writes `last_match_id = matchId` on both the per-game `ratings`
row (`match.ts` L164-169, `last_match_id = excluded.last_match_id`) and the
`overall_ratings` row (L175-181). So for every confirmed match, each
participant's `ratings` row (for that game) and `overall_ratings` row point at
that match — and the *most recent* confirmed match is guaranteed to still be
referenced. With `foreign_keys = ON` (`client.ts` L11/L23) and plain
`REFERENCES` (NO ACTION), `DELETE FROM matches WHERE id = ?` throws
`FOREIGN KEY constraint failed`. This breaks the primary use case (delete a
casual match / delete a tournament) 100% of the time, not an edge case.

**Fix:** before deleting the `matches` rows, in the same transaction, null the
back-references. `last_match_id` is nullable on both tables:

```sql
UPDATE ratings         SET last_match_id = NULL WHERE last_match_id IN (<deleted match ids>);
UPDATE overall_ratings SET last_match_id = NULL WHERE last_match_id IN (<deleted match ids>);
```

For `deleteMatch` it is the single id; for `deleteTournament` it is
`SELECT id FROM matches WHERE tournament_id = ?`. (Repointing to the prior
match would be nicer but is unnecessary for correctness — NULL is fine;
`last_match_id` is denormalized/rebuildable.) Do the null-out for **every**
deleted match, not only confirmed ones (harmless when the ref was already NULL),
and sequence it before the `DELETE FROM matches`. Revise the task's FK
inventory and cascade steps accordingly.

---

## Should-fix

### S1. `bets.match_id` is NOT NULL with no cascade — note the M6 interaction
`bets.match_id` (0001 L104) is `NOT NULL REFERENCES matches(id)`. M6 has no
writes yet so the table is empty and delete works today, but the task should
state explicitly that deleting a match with bets is out of scope / will FK-fail
until M6 adds escrow-aware teardown (and that `escrowed_elo` on the bettor is
intentionally left untouched by this task). This keeps the reversal path honest
when M6 lands. Not blocking only because the table is provably empty at MVP.

### S2. "Your rank" filter must also restrict the pool count, and null out for non-members
`overallPlayerRank`/`gamePlayerRank` (`queries.ts` L73-101) compute
`rank = 1 + COUNT(current_rating > me)` and `total = COUNT(*)` over the *whole*
`overall_ratings` / `ratings` pool. To respect the tournament filter the
implementation must add the member restriction to **both** the `higher` and the
`total` counts, and must also gate the `me` lookup: if the viewer is not a
member of the selected tournament, the function should return `null` so the
"your rank" affordance (`leaderboards/page.tsx` L41-49) hides rather than
showing a rank computed against a pool the viewer isn't in. The task says "gain
an optional member restriction" but doesn't call out the non-member case.

### S3. Be explicit that only `status='confirmed'` reverses; other statuses just delete rows
`deleteMatch` step 1 guards on confirmed, which is correct — only the
confirm/force-confirm/bracket paths ever run `applyEloUpdate`, so `pending`,
`scheduled`, `disputed`, and `cancelled` matches have NULL `rating_delta` /
`overall_rating_delta` and no rating effect. The task should state this
explicitly (delete pending/disputed/cancelled = delete `match_participants` +
`matches`, no reversal) so an implementer doesn't accidentally subtract NULL
deltas. Also note: a `pending` match is never bracket-linked (bracket rows are
created and confirmed in one transaction with `match_id` set —
`bracket.ts` L244-261), so the bracket guard and the pending path don't
collide.

### S4. Slug→id resolution and member-authorization for the filters
Both filters take `?tournament=<slug>` but the queries key on `tournament_id`.
The pages must resolve slug→id and fall back to "all" on an unknown/invalid
slug (mirroring the existing `activeTab` validation at
`leaderboards/page.tsx` L29). For `/matches`, restrict the `<select>` options to
the viewer's memberships; note that even if a non-member forces a `?tournament=`
value, the matches query already filters `mp.player_id = ?` (`matches/page.tsx`
L25) so no foreign matches leak — but the affordance should still only list
tournaments the viewer belongs to.

### S5. Migrate test: the hard-coded version array must go to 11
`tests/unit/migrate.test.ts` L53 asserts
`expect(versions.map(...)).toEqual([1,2,3,4,5,6,7,8,9,10])`. Adding `0011`
makes this fail until updated to include `11`. The task mentions "migrate test
+0011" — good — but flag the exact assertion so it isn't missed. Adding a
`PRAGMA table_info(match_participants)` check for the new nullable
`overall_rating_delta` column (mirroring the 0005/0006/0008 column tests) is
recommended.

---

## Confirmations (things the doc got right)

- **Only per-game delta is stored — new column needed. CONFIRMED.**
  `updateParticipant` (`match.ts` L182-185, L195) writes only `rating_before`
  and `rating_delta`, and those are the **per-game** values (`beforePerGame`,
  `dPerGame`). `overallDeltas` is computed (L155, L189) but never persisted. So
  reversal cannot reconstruct the overall delta from existing columns, and it is
  not recomputable at delete time (it depended on every participant's
  overall rating-at-the-time). Storing `overall_rating_delta REAL` (nullable) is
  the minimal correct change. Wiring it in is a single extra SET on
  `updateParticipant`; it is additive on a nullable column and cannot break the
  confirm/force-confirm/bracket callers.

- **`deleteTournament` cascade order is FK-safe *only after B1 is fixed*.**
  Ordering among the referencers the doc *does* handle is correct: delete
  `bracket_matches` (references both `matches.match_id` and
  `tournaments.tournament_id`) and `match_participants` before `matches`, and
  delete `matches` + `tournament_admins` + `tournament_members` (+
  `bracket_matches`) before `tournaments`. No out-of-order deletion among those.
  **But it is not FK-safe as written** because the `ratings.last_match_id` /
  `overall_ratings.last_match_id` null-out (B1) is absent from the order. With
  B1's UPDATEs inserted before `DELETE FROM matches`, the full order is safe.

- **Casual (non-bracket) tournament matches are handled.** `deleteTournament`
  deletes participants/matches by `tournament_id`, so both bracket-created
  matches and casually-logged tournament matches are covered; both have stored
  deltas (bracket via `applyEloUpdate` in `bracket.ts` L255, casual via the
  confirm path) so both reverse.

- **Bracket-linked guard is correct.** Blocking `deleteMatch` when a
  `bracket_matches.match_id = ?` row exists is the right guard. Walkovers have
  NULL `match_id` (`bracket.ts` L272-289) so there's nothing to individually
  delete for them; played bracket results always set `match_id`
  (`bracket.ts` L259-261) so they're caught. A casual match inside a bracket
  tournament has no `bracket_matches` row and remains individually deletable,
  which is correct.

- **`escrowed_elo` untouched.** Reversal only mutates `current_rating`; it never
  references `escrowed_elo`, consistent with the M6-reserve invariant documented
  in `match.ts` L171-174 and the `0001` schema comment (L91-92). Good.

- **Floor clamp is correct and necessary.** `overall_ratings.current_rating` has
  `CHECK (current_rating >= 0)` (0001 L95). Reversing with
  `MAX(0, current_rating - overall_rating_delta)` prevents a CHECK violation.
  Note this clamp makes reversal *non-exact* whenever a clamp ever fired (at
  apply-time via `MAX(0, ...)` in `upsertOverall`, or here) — acceptable per the
  fixed party decision and near-impossible for fresh ~1200 data. Per-game
  reversal is exact (per-game ratings are intentionally *not* floored —
  `match.ts` L161-163). `overall_ratings` has no `games_played` column, so the
  doc correctly decrements `games_played` only on the per-game `ratings` row.

- **Order-dependence caveat is accurate.** `current = 1200 + Σ deltas`;
  subtracting one delta is exact when it's the newest (last) delta, approximate
  otherwise, because the intervening matches' deltas were computed against
  ratings that included this match's effect and are not re-derived. Correct.

## Answers to the required follow-ups

- (a) Only the **per-game** delta is currently stored — CONFIRMED. The new
  `overall_rating_delta` column is genuinely required.
- (b) The proposed `deleteTournament` cascade order is **NOT FK-safe as
  written** (B1: missing `ratings.last_match_id` / `overall_ratings.last_match_id`
  null-out). It becomes FK-safe once those two UPDATEs are added before the
  `matches` delete.
