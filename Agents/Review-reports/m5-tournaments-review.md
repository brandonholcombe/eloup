# M5 — Tournaments — Review report

## Reviewer: claude-sonnet-4-6-m5-reviewer
## Task: m5-tournaments.md
## Date: 2026-05-15

> **Verdict: APPROVE WITH CHANGES.** The M5 plan is well-structured and demonstrates faithful
> continuity with what M4 actually shipped: the schema matches exactly, the BottomNav reserved
> slot is confirmed in the source, and the resolved Q-TOURN-1..4 answers are coherent and
> non-contradictory with the umbrella plan. However, the standings SQL as written is **provably
> broken** — it overcounts wins and matches_played by including casual (non-tournament) matches
> for players who have participated in matches outside the tournament. This is a correctness
> defect that would ship silent wrong data on day one. There is also a signature-change caller gap
> and a missing test case that are real but non-blocking. Fix the SQL before commit 3 lands.

---

## Findings

### [MAJOR]

**1. Standings SQL is broken: `match_participants` is joined independently of `matches`, causing casual matches to pollute tournament standings**

The plan proposes (§"Standings algorithm"):

```sql
LEFT JOIN match_participants mp
       ON mp.player_id = tm.player_id
LEFT JOIN matches m
       ON m.id = mp.match_id
      AND m.tournament_id = tm.tournament_id
      AND m.status = 'confirmed'
```

The `mp` (match_participants) LEFT JOIN is anchored only to `tm.player_id`. This means *every* `match_participants` row for the player is included — not just tournament-scoped ones. The subsequent LEFT JOIN to `matches m` restricts `m`, but because it is a LEFT JOIN from `mp`, rows where `m.id` is NULL (i.e., the match did not pass the `tournament_id` / `status` filter) still keep the `mp.match_id` and `mp.placement` values intact. The `COUNT(mp.match_id)` and `COUNT(CASE WHEN mp.placement = 1 THEN 1 END)` aggregates therefore count ALL of a player's confirmed match participations — tournament-scoped and casual alike.

Verified with `better-sqlite3` on a `:memory:` database: with one tournament match (Alice wins) and one casual match (Alice wins), the plan's query reports `alice.wins = 2, matches_played = 2`. The correct answer is `wins = 1, matches_played = 1`. Zero-match members (Carol) do correctly appear with zeros under the broken query — that edge case passes. But the isolation guarantee the plan explicitly promises ("The casual match does **not** influence the per-tournament wins count — proves the `m.tournament_id = tm.tournament_id` join") is false as written.

The integration test `tournament-match-and-standings.test.ts` explicitly tests this invariant (the last bullet in that suite), so the test will catch this — but only if the implementer runs the tests before commit 3 merges. Because the standings module `lib/tournament-standings.ts` is where this SQL lives, the fix must be in the plan itself so the implementer writes correct SQL from the start.

**Fix:** reverse the join order so `matches m` is the outer table and `match_participants mp` is joined *through* it:

```sql
LEFT JOIN matches m
       ON m.tournament_id = tm.tournament_id
      AND m.status = 'confirmed'
LEFT JOIN match_participants mp
       ON mp.match_id = m.id
      AND mp.player_id = tm.player_id
```

With this order, `mp` rows are only reached via confirmed tournament matches. Verified: Alice shows `wins = 1, matches_played = 1`, Carol shows `wins = 0, matches_played = 0`. The plan's stated edge-case guarantees all hold under the corrected query.

---

**2. `canEditMatch` signature change leaves the M4 unit-test caller unreconciled**

The plan states (§"Permissions extensions"):

> The original `canEditMatch(s, matchCreatedBy)` signature changes to take the match row instead of just `created_by` so the tournament-admin path can fire. M4 callers (just `/matches/[id]` edit gates, if any — verify in implementation) are updated in commit 3.

This is under-specified in a way that will silently break the build. The actual M4 caller is in `eloup-web/tests/unit/permissions.test.ts` at lines 62, 65, and 68:

```ts
expect(canEditMatch({ id: 'admin', role: 'global_admin' }, 'someone-else')).toBe(true);
expect(canEditMatch({ id: 'a', role: 'user' }, 'a')).toBe(true);
expect(canEditMatch({ id: 'a', role: 'user' }, 'b')).toBe(false);
```

All three call sites pass `matchCreatedBy` as a bare string — incompatible with the new `match: { created_by: string; tournament_id: string | null }` shape. A TypeScript build will fail at `pnpm typecheck` (step 4 of the verification checklist) and `pnpm test` will also fail at compile time. This is not a logical bug but it is a build-breaking omission. The plan says "verify in implementation" but the callers are already known from the repo; the plan should enumerate them.

There are **no** production callers of `canEditMatch` in `eloup-web/app/` or `eloup-web/components/` — the match detail page (`app/matches/[id]/page.tsx`) makes no edit-gate calls. The only change needed is updating the three `permissions.test.ts` call sites to pass the new shape. The plan's §"Test plan" adds new `canEditMatch` tests but does not mention updating the three existing tests that will break.

**Fix:** add an explicit bullet to commit 3's scope: "Update the three existing `canEditMatch` call sites in `tests/unit/permissions.test.ts` to pass `{ created_by: ..., tournament_id: null }` objects." This is a five-minute change but omitting it from the plan means the implementer may write the new signature and run `pnpm build` without running `pnpm test`, shipping a test suite that won't pass.

---

### [MINOR]

**3. Slug collision retry has a TOCTOU race with no plan-level mitigation**

The plan describes (Flow 1, step 1):

> Generate `slug` via `slugify(name)` with collision retry (`-2`, `-3`, ...).

The schema has `tournaments.slug TEXT NOT NULL UNIQUE` (confirmed in `0001_init.sql`). The collision retry loop is application-level: check whether `spring-cornhole-2026` exists, if so try `spring-cornhole-2026-2`, etc. But the INSERT also happens inside a `db.transaction` (Flow 1 step 2–4), and `better-sqlite3`'s `tx.immediate()` acquires a write lock only at transaction start — not before the slug check. Two concurrent tournament creates with the same name will both compute the same slug, both find it absent (before either INSERTs), and one will fail with a SQLite UNIQUE constraint error.

The plan notes the UNIQUE constraint exists but does not say how the API route handles the resulting `SqliteError: UNIQUE constraint failed: tournaments.slug`. The user will see a 500 if the route propagates the error uncaught.

This race is realistic in a party setting (two people simultaneously tapping "Create") and SQLite's single-writer model means one will win and one will get the constraint error. The plan should specify: catch `SqliteError` with `code === 'SQLITE_CONSTRAINT_UNIQUE'` on the INSERT, retry the slugify loop (or surface a 409 to the client with a "try a different name" message). The `slug.test.ts` test plan tests the happy-path retry but not the constraint-catch path.

**Fix:** add a note in the `createTournament` walkthrough: "If the INSERT fails with `SQLITE_CONSTRAINT_UNIQUE`, catch and retry the slug with the next suffix, or surface a user-friendly 409." Also add one test case to `slug.test.ts` or `tournament-lifecycle.test.ts` covering this path.

---

**4. Missing test: "consume revoked token" uses the wrong object shape**

The integration test plan lists:

> Revoked invite: after `revokeInvite`, the token returns `{status: 'invalid_token'}` from `consumeInvite`.

This is the right test, but the `consumeInvite` spec in Flow 3 says:

> If no row: render "Invite is no longer valid" page (HTTP 410).

The UI path (HTTP 410 page render) and the `consumeInvite` return value (`{status: 'invalid_token'}`) should be consistent. The integration test tests `consumeInvite` at the library level — that's fine. But the plan does not include a test that covers "revoke the token, then attempt to re-consume via the HTTP route" to verify the 410 is surfaced. The HTTP 410 path is the production failure mode a user will actually see if they follow a stale link.

This is not catastrophic — the library-level test covers the data-layer invariant — but the HTTP behavior (410 vs 404 vs 200-with-error) is unspecified in the test plan. A single integration test calling the `/tournaments/join/[token]` handler directly with a revoked token would close this gap.

---

### [NIT]

**5. `consumeInvite` return type is inconsistent between Flow 3 and the test plan**

Flow 3 says `consumeInvite` "returns the tournament row" on success. The test plan says the revoked-token path returns `{status: 'invalid_token'}`. The function therefore has two return shapes: a tournament row on success, and a status object on failure. The plan should be explicit about the return type signature (e.g. `Tournament | { status: 'invalid_token' }` or a tagged union) so the implementer and any future reader don't have to infer it from two scattered references.

---

## Things the plan got right

- **Schema fidelity.** The M5 plan matches the actual `0001_init.sql` exactly. Every table (`tournaments`, `tournament_admins`, `tournament_members`, `matches.tournament_id`) is used precisely as M4 left it. No phantom columns.
- **M4 hand-off fidelity.** The BottomNav reserved slot is confirmed in `BottomNav.tsx` (line 53–63). The `NewMatchForm.tsx` sends only `{gameId, participants}` today — the planned `tournamentId` extension is additive and backwards-compatible with the current Zod schema.
- **Partial-index syntax.** `CREATE INDEX ... WHERE col IS NOT NULL` is valid in the SQLite version the M4 image ships (tested against `better-sqlite3` 11.3.0, which bundles SQLite 3.46+). The `IF NOT EXISTS` clauses are harmless belt-and-suspenders.
- **`lib/db/match.ts` is correctly untouched.** Q-TOURN-2 = shared means no `applyEloUpdate` branch is needed. The existing `upsertOverall` preserves `escrowed_elo` (omits it from both the INSERT tuple and the ON CONFLICT SET clause), which M5 also does not disturb.
- **LEFT JOIN placement of the `m.tournament_id` filter on `idx_matches_tournament_status`.** The proposed partial index `ON matches(tournament_id, status) WHERE tournament_id IS NOT NULL` will accelerate the fixed standings query's `matches m ON m.tournament_id = ...` join.
- **Q-TOURN-4 / creator protection.** The `demoteFromAdmin` reject-unless-`global_admin` path is explicit and matches the role matrix in §4.2 of the umbrella plan.
- **Alignment plan.** Commit 3 leaves `symbols/` untouched; commit 4 edits `manifest.json` + `manifest.lock` together. `align.py lock` is idempotent and atomically writes the lock file — no partial state. The "alignment broken mid-edit" note in commit 4 is accurate (editing the doc and the symbol before running `lock` leaves a stale root hash), and the instruction to run `lock` before committing commit 4 resolves it correctly.
- **No wizard/k8s/Dockerfile/env-var changes.** Verified: the `NewMatchForm`'s `tournamentId` extension adds a JSON field; the wizard configmap and `APP_RUNTIME_SECRET_KEYS` are not touched. No new env var needs a wizard wiring.
- **Independent Review Rule.** `## Author: claude-opus-4.7-m5-implementer` vs `## Reviewer: claude-sonnet-4-6-m5-reviewer` — different agents, rule satisfied.

---

## Open questions the implementer should answer before commit 3

1. **Standings SQL** — adopt the corrected join order (MAJOR finding 1) and confirm the integration test in `tournament-match-and-standings.test.ts` passes with the fix before merging commit 3.
2. **`permissions.test.ts` call-site updates** — enumerate and update all three existing `canEditMatch(s, string)` call sites to `canEditMatch(db, s, matchRow)` as part of commit 3 (MAJOR finding 2).
3. **Slug collision 500 handling** — add a `SQLITE_CONSTRAINT_UNIQUE` catch in `createTournament` and document the client-facing error shape (MINOR finding 3).
