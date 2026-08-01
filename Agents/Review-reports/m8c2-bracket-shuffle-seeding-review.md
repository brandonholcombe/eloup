# Review — M8c.2 Bracket random seeding + admin shuffle

## Reviewer: claude-opus-4.8-m8c2-reviewer

Reviews task doc `m8c2-bracket-shuffle-seeding.md` (Author:
`claude-opus-4.8-m8c2-implementer`). Verified against the actual code in
`eloup-web/` (engine, bracket DB layer, API routes, invite flow, schema).

## Verdict: Approve-with-changes

The plan is sound and its central premise — the reseed gate — is **correct**.
The refactor and layering are the right shape. A few corrections and one
non-obvious pitfall (gate on `status='done'`, NOT on `match_id`) must be folded
in before implementation, plus some documentation gaps. No blocking design flaw.

Counts: **Blocking 0 · Should-fix 3 · Optional 4**

---

## #1 Reseed gate correctness (the crux) — VERIFIED CORRECT

Claim: reseed is safe iff `count(bracket_matches.status='done') == 0`, treating
`'bye'` as safe. This holds. Evidence from `lib/bracket/engine.ts`:

- **Generation byes are `'bye'`, never `'done'`.** `generateBracket` initializes
  every node `status: 'pending'` (`mk`, lines 65–82), then calls `resolveAll`
  (line 184). `resolveAll` only ever writes `'bye'` (line 216) for a
  walkover/auto-advance node, or `'ready'`/`'pending'` via `computeStatus`
  (lines 189–197). **`resolveAll` never writes `'done'`.** And `computeStatus`
  only *returns* `'done'` when the node is *already* `'done'` (line 191) — it
  cannot mint it. Therefore a freshly generated, untouched bracket can contain
  `pending`/`ready`/`bye` but **never `done`**, regardless of how many byes the
  draw has.
- **A played result → `'done'`.** `recordBracketResult` (`lib/db/bracket.ts`
  198) calls `advanceWinner`, which sets `n.status = 'done'` (engine line 266).
- **A walkover ALSO → `'done'`.** `recordWalkover` (bracket.ts 225) calls the
  *same* `advanceWinner`, so an admin-recorded no-show on a `'ready'` node also
  lands `'done'`. The doc's parenthetical ("only 'done' — a played result or a
  walkover — locks") is accurate. Note `recordWalkover` requires
  `node.status === 'ready'` (bracket.ts 223), so it can never be applied to a
  generation `'bye'` node — the two "walkover" notions don't collide.

**Edge cases checked, all safe:**
- Grand final `'done'` from generation alone? No — its feeds (WB-final winner /
  LB champion) aren't decided at generation, and `resolveAll` never emits
  `'done'` anyway. GF stays `pending`.
- 2-entrant / heavily-bye'd draw (e.g. `drawSize(2)=4`): both WR1 nodes become
  `'bye'`, WR2 `'ready'`, GF `pending` — no `'done'`. Confirmed by tracing
  `seedOrder(4)=[1,4,2,3]`.
- A "fully decided path" auto-resolving to `'done'` at generation: impossible —
  `resolveAll` propagates via `'bye'` only.

Conclusion: **`status='done' count == 0` is the correct AND complete gate.** See
the important corrective under Should-fix S1 about *which column* to test.

## #2 createBracket refactor — SOUND

`createBracket` (bracket.ts 94–131) opens `db.transaction(...)` and calls
`tx.immediate()`. better-sqlite3 transactions cannot nest, so `reseedBracket`
(DELETE + insert) genuinely needs its own transaction and a **non-transacting**
insert helper. Extracting `insertBracketNodes(db, tid, nodes)` from the INSERT
loop (lines 102–127) and having both callers wrap it is the right move.

- The `bracketExists` guard (line 100) and the `format='double_elim'` UPDATE
  (line 128) must stay **inside `createBracket`'s own transaction**, not move
  into the shared helper. `reseedBracket` must NOT re-run the exists-guard
  (it deletes first) but SHOULD keep/refresh the `format` set (harmless, or
  skip since format is already set). Call this out so the extraction doesn't
  accidentally drag the guard along. (Should-fix S2.)
- **FK/cascade:** `bracket_matches` (migration `0009_bracket.sql`) has
  `match_id TEXT REFERENCES matches(id)` — i.e. `bracket_matches` points *at*
  `matches`, and **nothing references `bracket_matches`** (its PK
  `(tournament_id, node_id)` is not an FK target anywhere). So a bulk DELETE of
  a tournament's `bracket_matches` orphans nothing and cascades nowhere. The
  played-result `matches`/`match_participants` rows are only ever created by
  `recordBracketResult` (which also sets `status='done'`), so when reseed is
  permitted they don't exist. The doc's "moot" is confirmed — provided the gate
  is on `status='done'` (S1).

## #3 Random seeding & layering — GOOD

Fisher–Yates with `Math.random` is fine: this is app UX, not a
security/fairness-critical draw, and the workflow-script ban doesn't apply.
`createBracket`/`generateBracket` already take an *ordered* `playersBySeedRank`
list (bracket.ts 96, engine.ts 59), so keeping the strategy (`shuffleSeeds` vs
`seedMembersByElo`) in the API caller matches the existing seam exactly. No
change to `generateBracket` needed. Good layering.

## #4 Scope / UX — REASONABLE, two doc gaps

- Random-by-default for a fresh Smash field (all ratings default 1200 →
  `seedMembersByElo` COALESCEs to 1200, breaking ties by `player_id`, i.e. an
  arbitrary-but-fixed order) is the right call. Approve.
- 409 handling for `has_results` is consistent with the existing 409 the create
  route already returns for "bracket already exists" (bracket.ts route line 24).
- **Members who joined after first generation:** `reseedBracket` regenerates
  from whatever list the caller passes, and the shuffle route will pass
  `shuffleSeeds(currentMemberIds)` — so a shuffle **does** pick up newly-joined
  members and drop removed ones. This is desirable pre-play, but the doc doesn't
  state it. Document it (Should-fix S3).

## #5 Invite → Discord → join claim — VERIFIED TRUE

The doc correctly treats this as already-built:
- `app/tournaments/join/[token]/route.ts`: signed-out → `signIn('discord', {
  redirectTo: callback })` (lines 12–16); signed-in →
  `consumeInvite(db(), token, session.user.id)`.
- `lib/invites.ts` `consumeInvite` (39–62): resolves the tournament by
  `invite_token`, INSERTs into `tournament_members` (or `already_member`),
  transactional.
- First Discord login `bootstrapPlayer`s a player row (`lib/auth.ts` 36 →
  `lib/db/players.ts` 22–58), with `display_name = global_name ?? username` —
  the Discord username shown on the bracket.
"Send link → Discord auth → join by username" is functional. Correctly
out-of-scope / document-only.

---

## Findings

### Should-fix

**S1 — Gate on `status='done'`, NOT on `match_id`.** (This is the one real
trap.) A tempting alternative "has any result?" test is
`match_id IS NOT NULL`, but `recordWalkover` advances a node to `'done'`
*without* creating a `matches` row or setting `match_id` (bracket.ts 213–230).
So a walkover-advanced bracket has `status='done'` yet all `match_id` NULL.
Gating on `match_id` would wrongly permit a reseed that wipes a recorded
walkover. The doc already specifies `status='done'` — good — but the
implementation and the integration test must both assert this column
explicitly, and the code comment should say *why* (walkovers set `done` with a
NULL `match_id`). Add a walkover case to the reseed test, not just a played
result.

**S2 — Keep the `bracketExists` guard and `format` set inside
`createBracket`'s transaction; extract only the INSERT loop.** The shared
`insertBracketNodes` helper must be pure INSERT with no guard. `reseedBracket`
does its own `DELETE FROM bracket_matches WHERE tournament_id=?` then
`insertBracketNodes`, all inside one `tx.immediate()`; it must not call the
exists-guard. Verify `createBracket`'s behavior is byte-for-byte unchanged
after the extraction.

**S3 — Document the "shuffle regenerates from the *current* member list"
semantics.** Non-goals/behavior should state that shuffling (and any regen)
re-reads current `tournament_members`, so members added/removed since first
generation are included/excluded. It's the desired behavior but currently
implicit.

### Optional

**O1 — Also update the page's descriptive copy, not just the confirm dialog.**
`app/tournaments/[slug]/page.tsx` line 85–86 hardcodes "…from the current
members (seeded by ELO)." Change to reflect random draw alongside the
`CreateBracketButton` confirm-copy update (doc §3 only mentions the confirm
text).

**O2 — Terminology note in the reseed code.** The engine comment in `resolveAll`
uses "walkover" for generation auto-advance (`'bye'`), while the API
`recordWalkover` uses it for an admin no-show (`'done'`). A one-line comment on
the gate query disambiguating these will save the next reader.

**O3 — Consider surfacing a distinct message for the create route's existing
409 vs the shuffle route's 409.** Both mean different things ("already exists"
vs "locked — results reported"); the button currently renders raw `resp.text()`
(`CreateBracketButton.tsx` 28). Make the shuffle button map 409 → "locked —
results reported" per the doc rather than dumping the body.

**O4 — Empty-`seeding` / bad-body handling on the create route.** The create
route currently reads no body (bracket.ts route). When adding `{ seeding }`,
default to `'random'` on missing/invalid body (don't 400), preserving the
one-click button flow.

---

## Corrections to the task doc
1. Make explicit that the reseed gate query is on the `status` column
   (`status='done'`), and that `match_id`-based detection is WRONG because
   walkovers set `done` with NULL `match_id`. (S1)
2. State that `insertBracketNodes` is INSERT-only; the exists-guard and
   `format` UPDATE remain in `createBracket`. (S2)
3. Add the "regenerates from current members" note. (S3)
4. Integration test should cover **both** a played result and a walkover as
   "locks the bracket" cases (the file is `tests/integration/bracket-db.test.ts`,
   not `bracket-db.test.ts` at root — minor path nit).
