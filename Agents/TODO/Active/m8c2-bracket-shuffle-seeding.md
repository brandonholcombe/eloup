# M8c.2 — Bracket random seeding + admin shuffle

## Author: claude-opus-4.8-m8c2-implementer
## Status: Complete

## Outcome (2026-08-01) — SHIPPED, verified live

- `lib/db/bracket.ts`: `shuffleSeeds` (Fisher–Yates), `shuffledMembers`,
  `insertBracketNodes` (extracted, non-transacting — `createBracket` guard +
  format preserved), `reseedBracket` (gate on `status='done'`, S1).
- API: create accepts `seeding: 'random'|'elo'` (default random);
  `POST .../bracket/shuffle` (409 when locked).
- UI: create copy = "random draw"; `ShuffleBracketButton` (🎲) shown to admins
  only while `!bracketStarted`.
- Tests: shuffle permutation, reseed-then-lock, **walkover locks reseed** (S1).
  vitest 339 → 342.
- Verified live: generate → shuffle reorders WR1 → report result → shuffle button
  gone (locked).
- Signup flow (invite → Discord → join-by-username) confirmed already functional
  (M5) — documented, no new work.

## Reviewer findings folded (2026-08-01)

Review at `Agents/Review-reports/m8c2-bracket-shuffle-seeding-review.md`: **Approve-
with-changes** — 0 blocking, 3 should-fix. The crux confirmed: `count(status=
'done')==0` IS the correct/complete reseed gate; generation byes are `'bye'` not
`'done'`; both played results and walkovers set `'done'`. Folded:
- **S1 (trap):** gate on the **`status` column, NOT `match_id`** — a walkover is
  `status='done'` with NULL `match_id`, so a match_id check would wrongly allow a
  reseed that erases a recorded walkover. Integration test MUST include a walkover
  case asserting reseed is then blocked.
- **S2/S3:** the `insertBracketNodes` extraction must preserve `createBracket`'s
  exists-guard + `format='double_elim'` set; verify createBracket still behaves.
- **Doc:** reseed regenerates from the CURRENT members (so someone who joined
  after the first generate is included on shuffle) — intended; note it in the UI.
- Confirmed: FK-safe to bulk-DELETE `bracket_matches`; Fisher–Yates/`Math.random`
  fine in app code; invite→Discord→join genuinely already works.

## Parent / context

Follow-up to `m8c-smash-double-elim.md` (shipped). The user wants: send a signup
link → users Discord-auth → join → bracket built from their usernames → an admin
**shuffle** button.

**Already built (M5 invites + M8c) — NO new work, document only:**
- Send-a-link + Discord signup: the tournament **invite link** (`issueInvite`,
  `InviteCard`, `/tournaments/join/[token]`). Hitting it signed-out runs
  `signIn('discord', { redirectTo })` → Discord OAuth → `consumeInvite` adds the
  member; first login `bootstrapPlayer`s a player row from the Discord username.
- Bracket entrants are the tournament members, displayed by `display_name`
  (Discord username). `createBracket` already builds from a member list.

**New work: random draw + shuffle.** Today `createBracket` seeds by overall ELO
(`seedMembersByElo`) — meaningless for a fresh Smash field (all default 1200). A
party wants a random draw and the ability to re-shuffle before play starts.

## Scope

### 1. `lib` — random seeding + reseed
- **Fisher–Yates shuffle** of the member id list (`Math.random` is fine in app
  code — the ban is only in workflow scripts). Add `shuffleSeeds(ids): string[]`
  (pure; testable by stubbing/seeding is unnecessary — test it permutes + keeps
  the same multiset).
- **`reseedBracket(db, tournamentId, playersBySeedRank)`** — regenerate a bracket
  with a new order, allowed ONLY before any result is reported. In one
  transaction: if any `bracket_matches.status = 'done'` exists → return
  `{ status: 'has_results' }` (locked); else DELETE the tournament's
  `bracket_matches` and re-insert from a fresh `generateBracket`.
  - **Refactor:** extract a non-transacting `insertBracketNodes(db, tid, nodes)`
    from `createBracket` so both `createBracket` (wraps in txn + `exists` guard +
    `format` set) and `reseedBracket` (txn + delete) reuse it — `createBracket`
    currently opens its own `tx.immediate()`, which can't nest.
  - Note: `status='bye'` (generation auto-advance) is NOT a "result" — only
    `'done'` (a played result or a walkover) locks the bracket. Verify this
    distinction against `advanceWinner`/`recordWalkover`.

### 2. API
- `POST /api/tournaments/[slug]/bracket` — accept `{ seeding?: 'random' | 'elo' }`
  (default **`random`**). Random → `shuffleSeeds(memberIds)`; elo →
  `seedMembersByElo`. Admin-gated (existing check).
- `POST /api/tournaments/[slug]/bracket/shuffle` — admin: `reseedBracket` with a
  fresh random order. Returns 409 if `has_results`.

### 3. UI (`/tournaments/[slug]`)
- **CreateBracketButton:** generate with a **random draw** by default (update the
  confirm copy: "random draw"). Keep an ELO option only if trivial (a small
  select) — otherwise random-only for MVP; ELO seeding stays reachable via the API.
- **Shuffle button** (admin, only when a bracket exists AND no result reported):
  re-randomizes the seeding. Confirm dialog ("Reshuffle the draw? Only works
  before the first result."). Hidden/disabled once any result is in (or shows a
  "locked — results reported" note on 409).
- Reuse `<Button>`, tokens.

## Testing / verification
- Unit: `shuffleSeeds` returns a permutation (same multiset, length) — run a few
  times; and `reseedBracket` gating logic where feasible.
- Integration (extend `bracket-db.test.ts`): create → reseed changes the WR1
  entrant order; report one result → reseed returns `has_results` and leaves the
  bracket unchanged.
- `pnpm lint`/`typecheck`/`build`/`test` green.
- Verify live in the local harness: generate a random bracket, shuffle it (order
  changes), report a result, confirm shuffle is then blocked.
- No schema change (reuses `bracket_matches`); no symbol change expected.

## Non-goals
Manual drag-to-seed ordering; per-seed locking; re-open a locked bracket. The
invite/signup flow itself (already built) — only document how to use it.

## Review gate
Edits `eloup-web/`. Needs an independent review by a different agent than
`## Author:`, referencing `m8c2-bracket-shuffle-seeding.md`, before implementation
— focus on the reseed "no results reported" gate correctness (bye vs done) and the
`createBracket` refactor not breaking the existing txn/guard.
