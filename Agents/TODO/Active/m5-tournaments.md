# M5 — Tournaments, admin delegation, invite links

## Author: claude-opus-4.7-m5-implementer
## Status: Not Started

> Builds on M4 (eloup-web MVP shipped, schema in place). Wires the
> `tournaments` / `tournament_admins` / `tournament_members` tables that
> M4 left empty and the `matches.tournament_id` column that M4 left
> unused. Resolves Q-TOURN-1..4 with explicit values + rationale; the
> reviewer can push back, the user can override. After review, lands in
> two `feat:` commits.

---

## Scope at a glance

- Decide and document Q-TOURN-1..4 (and one cross-cutting question
  about `players.role`).
- Migration `0002_tournament_indexes.sql` — indexes only. No new tables.
  Reuses the existing `tournaments.invite_token` column for invites
  (scope tightening — see §"Scope tightenings" below).
- Server-side: `lib/tournaments.ts`, `lib/invites.ts`,
  `lib/permissions.ts` extensions; one new server-side module
  `lib/tournament-standings.ts` for the standings query.
- API routes: `/api/tournaments` (POST), `/api/tournaments/[slug]/invite`
  (POST rotate / DELETE clear), `/api/tournaments/[slug]/members/[playerId]`
  (DELETE remove — admin only), `/api/tournaments/[slug]/admins/[playerId]`
  (PUT promote, DELETE demote — admin only).
- UI routes: `/tournaments` (my list), `/tournaments/new` (create form),
  `/tournaments/[slug]` (detail — standings, members, recent matches,
  inline admin controls visible only to admins), `/tournaments/join/[token]`
  (join via shared link, auth-required).
- Match form extension: `/matches/new` gains an optional tournament
  picker. When set, `matches.tournament_id` is populated and the
  participant picker is constrained to the tournament's members.
- BottomNav: replace the disabled "Soon" placeholder with a live
  `/tournaments` link.
- Standings algorithm: tournament-scoped record (W-L from confirmed
  matches with this `tournament_id`) ranked by wins desc, matches
  played asc, overall ELO desc as tiebreak. Same algorithm for every
  tournament; no per-game / cross-game branching in MVP.
- Update `symbols/manifest.json` `tournaments` symbol — replace four
  `"TBD"` properties with real values. Update `docs/tournaments.md` to
  match. Re-run `python3 scripts/align.py lock`.

---

## Workflow gate

1. This task doc is committed first (and **only** it). The review-gate
   hook then blocks `eloup-web/` edits until a review report exists
   at `Agents/Review-reports/m5-tournaments-review.md` with a `## Reviewer:`
   different from the `## Author:` above (the convention from M2–M4
   reviewers is `claude-sonnet-4-6-m<N>-reviewer`).
2. After the review report lands, this task moves to
   `## Status: In Progress` and the implementer ships commits 3 and 4
   below.
3. On verification pass, this task moves to `## Status: Complete`.

---

## Resolved questions

### Q-TOURN-1 — bracketed event vs named group → **named group**

The `tournaments.format` column is set to the literal string
`"named_group"` on every row M5 creates. The `/tournaments/new` form
has **no** format dropdown — there is one option in MVP. Bracketed
formats (single-elim, double-elim, round-robin, swiss) are deferred to
a later milestone (provisionally M5b) because the seed→advance UI is a
separate large lift the party-app target use case (a season of cornhole
matches between friends) does not require.

**Symbol update:** `tournaments.format` = `"named_group"`.

### Q-TOURN-2 — rating pool → **shared per-game ELO**

Confirmed matches inside a tournament write to the same `ratings` and
`overall_ratings` tables as casual matches. The M4 confirm-match
transaction in `lib/db/match.ts` is unchanged. No `tournament_ratings`
table, no branch on `match.tournament_id` in `applyEloUpdate`.

The standings algorithm (below) uses tournament-scoped W/L counts as
the primary ranking signal, so a player's overall global ELO doesn't
dominate within-tournament standing — fixed and casual matches don't
swamp the picture of "who's winning *this* tournament."

**Symbol update:** `tournaments.rating_pool` = `"shared"`.

### Q-TOURN-3 — invite semantics → **single shared revocable link**

The existing `tournaments.invite_token` column (TEXT, nullable) is the
storage. One token per tournament at a time. `issueInvite` generates a
fresh 24-character URL-safe random token and writes it. `revokeInvite`
sets the column to NULL. `consumeInvite(token, playerId)` looks up the
tournament by token (NULL tokens never match, so a revoked token cannot
be used), inserts into `tournament_members` if not already present, and
returns the tournament. Rotating = issue + replace.

**Symbol update:** `tournaments.invite_model` = `"single_shared_link"`.

### Q-TOURN-4 — creator demotable → **permanent**

The original creator (`tournaments.owner_id`) cannot be demoted from
`tournament_admins` by another admin. The creator is implicitly an
admin (a `tournament_admins` row is inserted at creation time for
auditability), and the `demoteFromAdmin` helper rejects the demotion
if `playerId === tournaments.owner_id` unless the caller is a
`global_admin`. Global admins can override anything.

**Symbol update:** `tournaments.creator_demotable` = `false`.

### Cross-cutting — `players.role` and tournament-admin status → **derived from rows**

`players.role` stays in `{user, global_admin}` for the purposes of M5
permission code. The CHECK constraint in `0001_init.sql` still permits
`tournament_admin`, but M5 never writes that value. Permission helpers
read `tournament_admins` directly. Single source of truth, no
demotion-bookkeeping bug class. The vestigial enum value is harmless
and can be removed later if desired (SQLite column drops are
expensive; not worth it for M5).

This decision means the role matrix from §4.2 of
`project-review-and-plan.md` is honored functionally — a player listed
in any `tournament_admins` row gets `tournament_admin`-level
permissions on that tournament — but **not** by promoting their
global `role`. Permission helpers do the lookup.

---

## Scope tightenings (chosen against M5 prompt defaults)

The M5 prompt proposed three larger structures that the user signed off
on tightening before this doc was written:

1. **No `tournament_invites` table.** The existing single-column model
   covers Q-TOURN-3's resolved value (one shared revocable link).
   Expiry, max-uses, per-invitee tokens, join-requests are all post-MVP
   features and require a future migration regardless of which path we
   take now.
2. **No `/tournaments/[slug]/admin` sub-route.** Admin controls
   (promote/demote/remove/invite-rotate) render inline on the detail
   page, visible only when the viewer is a `tournament_admin` for that
   tournament (or a `global_admin`). One route, fewer taps, standard
   mobile pattern.
3. **No `players.role` sync.** Tournament-admin status is derived from
   the `tournament_admins` table by permission helpers, not mirrored
   onto the global role column.

Net effect: M5 is server-side smaller than M4 was, and the UI
surface is three new routes (`/tournaments`, `/tournaments/new`,
`/tournaments/[slug]`) plus one public join URL. The match form gets a
single optional dropdown.

---

## Migration `0002_tournament_indexes.sql`

```sql
-- 0002_tournament_indexes.sql — M5 indexes for tournament lookups.
-- No new tables; reuses M4's tournaments / tournament_admins /
-- tournament_members / matches.tournament_id (all from 0001_init.sql).

CREATE INDEX IF NOT EXISTS idx_tournaments_invite_token
  ON tournaments(invite_token) WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_members_player
  ON tournament_members(player_id);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_status
  ON matches(tournament_id, status) WHERE tournament_id IS NOT NULL;
```

The `IF NOT EXISTS` clauses are belt-and-suspenders; the migration
table already guards against re-running. They are kept for resilience
if a future operator inspects the file.

Partial indexes on the nullable columns (`invite_token`,
`tournament_id`) keep the indexes small — only rows that actually
have a value are indexed.

The placeholder `tournaments.invite_token` column from
`0001_init.sql` is **kept and used** (per the scope tightening). It is
not dropped (SQLite column drop pre-3.35 is painful and 3.35+ requires
table rebuild for CHECK changes — not worth it).

---

## Route table

### UI routes

| Path | Method | Auth | Purpose |
|---|---|---|---|
| `/tournaments` | GET | required | List tournaments the viewer is a member of. Empty state nudges to `/tournaments/new`. |
| `/tournaments/new` | GET | required | Create form: name (text), ends_at (optional datetime-local). |
| `/tournaments/[slug]` | GET | required (member or global_admin) | Detail page: standings, members, recent matches, inline admin panel if viewer is an admin. |
| `/tournaments/join/[token]` | GET | required | Consumes the invite token. Adds viewer to `tournament_members` if not already present. Redirects to `/tournaments/[slug]`. Surfaces friendly errors for revoked / unknown tokens. |
| `/matches/new` (extended) | GET | required | New optional "Tournament" dropdown above the game picker. When selected, participant choices are constrained to that tournament's members. |

### API routes

| Path | Method | Auth | Purpose |
|---|---|---|---|
| `/api/tournaments` | POST | user+ | Create tournament. Creator becomes admin + member. Returns `{id, slug}`. |
| `/api/tournaments/[slug]/invite` | POST | admin of slug or global_admin | Rotate token. Returns `{token, joinUrl}`. |
| `/api/tournaments/[slug]/invite` | DELETE | admin of slug or global_admin | Clear token (revoke). Returns `{revoked: true}`. |
| `/api/tournaments/[slug]/members/[playerId]` | DELETE | admin of slug or global_admin | Remove member. Cannot remove the creator. Also drops them from `tournament_admins` if present. |
| `/api/tournaments/[slug]/admins/[playerId]` | PUT | admin of slug or global_admin | Promote member to tournament admin (idempotent — INSERT OR IGNORE). |
| `/api/tournaments/[slug]/admins/[playerId]` | DELETE | admin of slug or global_admin | Demote tournament admin. Rejects if `playerId === owner_id` and caller is not `global_admin`. |

Existing `/api/matches` POST extension: the request body gains an
optional `tournamentId` field. When present, the route asserts the
caller is a member of that tournament, asserts every listed
participant is also a member, and writes the value into
`matches.tournament_id`.

No new auth handler is needed — `auth()` from `lib/auth.ts` continues
to gate every route. The session shape already exposes
`session.user.id` and `session.user.role`.

---

## The six must-work flows

### Flow 1 — Create a tournament

Alice signs in. Hits `/tournaments` → empty list → "Create one" CTA →
`/tournaments/new`. Submits `{name: "Spring Cornhole 2026", endsAt: null}`.
Server action `createTournament`:

1. Generate `id` via `randomUUID`, `slug` via `slugify(name)` with
   collision retry (`-2`, `-3`, ...).
2. `INSERT INTO tournaments(id, name, slug, owner_id, format, created_at)
   VALUES (?, ?, ?, ?, 'named_group', datetime('now'))`.
3. `INSERT INTO tournament_admins(tournament_id, player_id) VALUES (?, ?)`.
4. `INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`.
   All four in one `db.transaction`.
5. Return `{id, slug}`. Client redirects to `/tournaments/[slug]`.

**TOCTOU race on slug.** Two concurrent creates with the same name
both pre-compute the same slug, both see no collision, then race the
INSERT. SQLite's `UNIQUE` constraint guarantees one of them fails
with `SqliteError.code === 'SQLITE_CONSTRAINT_UNIQUE'`. The
`createTournament` helper catches that error and re-enters the
slugify loop with the next suffix (`-2`, then `-3`, ...). A bounded
retry of 5 attempts is enough — beyond that, surface a 409 with
`"slug exhausted, try a different name"`. The retry happens
*inside* the transaction's catch, so partial inserts roll back
cleanly between attempts.

### Flow 2 — Generate and share an invite link

Alice is now on `/tournaments/spring-cornhole-2026`. As an admin, she
sees an "Invite" card with a "Generate link" button. Tapping it calls
`POST /api/tournaments/spring-cornhole-2026/invite`:

1. `assertIsTournamentAdmin(viewerId, tournamentId)`.
2. `token = randomURLSafe(24)`.
3. `UPDATE tournaments SET invite_token = ? WHERE id = ?`.
4. Return `{token, joinUrl: 'https://<host>/tournaments/join/<token>'}`.

The card replaces the button with the URL + a "Copy" button (uses
`navigator.clipboard.writeText` — mobile-native API, no library). A
"Rotate" button calls POST again (replacing the token); a "Revoke"
button calls DELETE (sets the column NULL).

### Flow 3 — Join via the invite link

Bob receives the URL out-of-band. Opens it on his phone. Auth gate
redirects to Discord OAuth if unauthenticated; lands on the join URL
post-auth. `/tournaments/join/[token]`:

1. `assertSignedIn()`.
2. `tournament = consumeInvite(token, viewerId)`.
3. `consumeInvite(token, playerId)` — signature
   `(db, token: string, playerId: string) => Tournament | { status: 'invalid_token' }`:
   - `SELECT id, name, slug, ... FROM tournaments WHERE invite_token = ?`
     (partial index scan; NULL tokens never match, so revoked tokens
     fail this lookup).
   - If no row: return `{ status: 'invalid_token' }`. The
     `/tournaments/join/[token]` handler maps this to an HTTP 410
     response and renders "Invite is no longer valid".
   - `INSERT OR IGNORE INTO tournament_members(tournament_id, player_id)
     VALUES (?, ?)` — idempotent: already-a-member is a success path.
   - Return the tournament row.
4. Redirect to `/tournaments/[slug]`.

### Flow 4 — Promote a member to co-admin

Alice taps Bob's row in the member list. As an admin, she sees a
"Promote to admin" button (Bob is currently a member but not an
admin). PUT `/api/tournaments/spring-cornhole-2026/admins/<bob-id>`:

1. `assertIsTournamentAdmin(aliceId, tournamentId)`.
2. `assertIsTournamentMember(bobId, tournamentId)` — can't promote a
   non-member.
3. `INSERT OR IGNORE INTO tournament_admins(tournament_id, player_id)
   VALUES (?, ?)`.
4. Return `{promoted: true}`. Client refreshes the page; Bob's row
   now shows the "admin" badge.

### Flow 5 — Log a tournament-scoped match

Bob (now a member, not an admin) heads to `/matches/new`. He picks
"Spring Cornhole 2026" from the optional tournament dropdown at the
top. The page re-fetches the participant list to show only members of
that tournament. He picks game (Cornhole), himself + Alice, sets
placements, submits.

`POST /api/matches` body now includes `tournamentId`:

1. `assertSignedIn()`.
2. If `tournamentId` present:
   - `assertIsTournamentMember(viewerId, tournamentId)`.
   - For each participant: `assertIsTournamentMember(participant.playerId, tournamentId)`.
   - If any fails → 403, no match created.
3. The existing INSERT logic runs with `tournament_id` populated.
4. Returns `{id: matchId}`.

The M4 confirm-match transaction is unchanged. When the last
participant confirms, ratings update against the global per-game ELO
pool (Q-TOURN-2 = shared) — and standings recompute on the next read
because they're a live query, not a denormalized count.

### Flow 6 — View the detail page

Carol (a member, not an admin) opens `/tournaments/spring-cornhole-2026`.
The page renders three sections, top-to-bottom on a phone:

1. **Header** — name, ends_at (if set), member count. If Carol were an
   admin she'd see the "Invite" card here.
2. **Standings** — top N (10 on mobile, all on desktop) ranked by
   `wins DESC, matches_played ASC, overall_elo DESC` (algorithm
   below). Each row: rank, avatar, display name, W-L, total played.
   The current viewer's row is sticky if they're outside the top N.
3. **Recent matches** — last 5 confirmed matches with
   `tournament_id = this`. Each row links to the existing
   `/matches/[id]` detail page (M4 route).
4. **Members** — full roster, sorted alphabetically. If Carol were an
   admin, each row would have inline "Promote" / "Demote" / "Remove"
   controls. As a member-only she just sees the names.

---

## Permissions extensions (`lib/permissions.ts`)

```ts
export function isTournamentMember(
  db: Database.Database,
  playerId: string,
  tournamentId: string,
): boolean { /* SELECT 1 FROM tournament_members WHERE ... */ }

export function isTournamentAdmin(
  db: Database.Database,
  s: SessionPlayer | null,
  tournamentId: string,
): boolean {
  if (!s) return false;
  if (s.role === 'global_admin') return true;
  // SELECT 1 FROM tournament_admins WHERE tournament_id = ? AND player_id = ?
}

export function canEditMatch(
  db: Database.Database,
  s: SessionPlayer | null,
  match: { created_by: string; tournament_id: string | null },
): boolean {
  if (!s) return false;
  if (s.role === 'global_admin') return true;
  if (s.id === match.created_by) return true;
  if (match.tournament_id && isTournamentAdmin(db, s, match.tournament_id)) return true;
  return false;
}
```

The original `canEditMatch(s, matchCreatedBy)` signature changes to
take the match row instead of just `created_by` so the
tournament-admin path can fire. **No production callers exist** in
`eloup-web/app/` or `eloup-web/components/` (the match detail page
makes no edit-gate calls). The only callers are three lines in
`tests/unit/permissions.test.ts`:

- Line 62: `canEditMatch({ id: 'admin', role: 'global_admin' }, 'someone-else')` → pass `{ created_by: 'someone-else', tournament_id: null }`.
- Line 65: `canEditMatch({ id: 'a', role: 'user' }, 'a')` → pass `{ created_by: 'a', tournament_id: null }`.
- Line 68: `canEditMatch({ id: 'a', role: 'user' }, 'b')` → pass `{ created_by: 'b', tournament_id: null }`.

All three updates land in commit 3. Without them, `pnpm typecheck`
and `pnpm test` fail at compile time even though no runtime behavior
changes. Both new and existing `canEditMatch` tests run against the
new signature.

| Action | Helper called |
|---|---|
| `POST /api/tournaments` | `assertSignedIn` (any user can create) |
| `POST /api/tournaments/[slug]/invite` | `assertIsTournamentAdmin` |
| `DELETE /api/tournaments/[slug]/invite` | `assertIsTournamentAdmin` |
| `DELETE /api/tournaments/[slug]/members/[playerId]` | `assertIsTournamentAdmin` + creator-protection |
| `PUT /api/tournaments/[slug]/admins/[playerId]` | `assertIsTournamentAdmin` + `assertIsTournamentMember` (target) |
| `DELETE /api/tournaments/[slug]/admins/[playerId]` | `assertIsTournamentAdmin` + creator-protection (unless global_admin) |
| `POST /api/matches` (with `tournamentId`) | `assertIsTournamentMember` (caller + every participant) |
| `GET /tournaments/[slug]` | viewer is member OR `global_admin`; else 404 (prefer 404 over 403 so non-members can't enumerate slugs) |

---

## Standings algorithm

Per-tournament standings are a live SQL view, computed on each detail
page load (no denormalization, no scheduled job):

```sql
SELECT
  p.id              AS player_id,
  p.display_name,
  p.avatar_url,
  o.current_rating  AS overall_rating,
  COUNT(CASE WHEN mp.placement = 1 THEN 1 END) AS wins,
  COUNT(mp.match_id)                            AS matches_played
FROM tournament_members tm
JOIN players p              ON p.id = tm.player_id
LEFT JOIN overall_ratings o ON o.player_id = tm.player_id
LEFT JOIN matches m
       ON m.tournament_id = tm.tournament_id
      AND m.status = 'confirmed'
LEFT JOIN match_participants mp
       ON mp.match_id  = m.id
      AND mp.player_id = tm.player_id
WHERE tm.tournament_id = ?
GROUP BY p.id, p.display_name, p.avatar_url, o.current_rating
ORDER BY wins DESC, matches_played ASC, overall_rating DESC, p.display_name ASC;
```

The join order matters and is **not** symmetric: `matches m` must be the
outer LEFT JOIN (filtered to the tournament + status), and
`match_participants mp` must join *through* it on
`mp.match_id = m.id AND mp.player_id = tm.player_id`. The intuitive
"join mp first, then narrow with m" structure causes casual
(non-tournament) match rows to leak into `wins` and `matches_played`
— verified broken with a `better-sqlite3` repro during review.

A "win" is `placement = 1`. Team formats use placement-by-team-rank
(every member of the winning team has `placement = 1`), so team
tournaments work too. FFA tournaments give `placement = 1` to the
solo first-place finisher only.

Edge cases:
- Member with zero matches in this tournament: `wins = 0`,
  `matches_played = 0`. Sorts to the bottom by overall ELO.
- Member without an `overall_ratings` row: `overall_rating` is NULL,
  rendered as `—`. Sorts last among zero-game members.
- A confirmed match scoped to a different tournament does not count;
  the `m.tournament_id = tm.tournament_id` join condition rules it out.

**Mobile rendering of the standings table:** card-per-row layout, not
a true HTML table. The mobile breakpoint shows three lines per card:
`#rank • avatar • Display Name`, then `W-L (n played)`, then `overall
ELO ####`. Desktop (≥640px) collapses each card into a single table
row with columns `# | Player | W | L | Played | Overall`. Sticky
current-viewer row when out-of-view.

---

## Test plan

Target: ~14 new Vitest tests added to the M4 base of 35, ending at ~49
(two test cases added during review: the slug TOCTOU retry path and
the HTTP-410-on-revoked-token path).

### Unit (`tests/unit/`)

`permissions.test.ts` (extends existing):

- `isTournamentMember` returns true/false for a seeded membership row.
- `isTournamentAdmin` returns true for a row in `tournament_admins`.
- `isTournamentAdmin` returns true for any `global_admin` regardless of
  membership.
- `isTournamentAdmin` returns false for a member who is not an admin.
- `canEditMatch` returns true for the match creator (existing
  behavior preserved).
- `canEditMatch` returns true for a tournament admin on a match scoped
  to their tournament.
- `canEditMatch` returns false for an unrelated user.

`slug.test.ts` (new):

- `slugify('Spring Cornhole 2026!')` → `'spring-cornhole-2026'`.
- Collision retry: when `spring-cornhole-2026` exists, the next call
  returns `'spring-cornhole-2026-2'`.
- TOCTOU catch path: a stubbed insert that throws
  `SQLITE_CONSTRAINT_UNIQUE` on the first attempt causes the helper
  to retry with the `-2` suffix and succeed.

### Integration (`tests/integration/`)

`tournament-lifecycle.test.ts` (new) — ephemeral SQLite per file
(matches M4 pattern):

- Create tournament: Alice creates "T1", row exists, Alice in both
  `tournament_admins` and `tournament_members`.
- Issue invite: token written to `tournaments.invite_token`,
  20+ chars, URL-safe.
- Consume invite: Bob joins, `tournament_members` row exists, second
  consume is idempotent (no duplicate row error).
- Revoked invite: after `revokeInvite`, the token returns
  `{status: 'invalid_token'}` from `consumeInvite`.
- Revoked-invite HTTP path: a GET to the `/tournaments/join/[token]`
  route handler (invoked directly, not via Playwright) with a
  revoked token returns HTTP 410 and does not insert a
  `tournament_members` row. Closes the gap between the
  library-level invariant and the user-visible failure mode.
- Promote + demote: Alice promotes Bob, `tournament_admins` row exists,
  demote removes it.
- Creator protection: demoting the creator throws; demoting via a
  `global_admin` succeeds.

`tournament-match-and-standings.test.ts` (new):

- Create T1, add Alice + Bob + Carol as members.
- Log + confirm a match (Alice vs Bob, Alice wins, `tournament_id` set).
- Log + confirm a casual match (Alice vs Bob, no `tournament_id`).
- Standings query returns: Alice (1W, 1 played), Bob (0W, 1 played),
  Carol (0W, 0 played) in that order. Carol's row ties broken by
  overall ELO + display name.
- The casual match does **not** influence the per-tournament wins
  count (proves the `m.tournament_id = tm.tournament_id` join).
- Per-game `ratings` table reflects both matches' deltas (proves
  Q-TOURN-2 = shared pool).

`tournament-match-membership-guard.test.ts` (new):

- Attempting to create a match with `tournamentId` set but a
  non-member participant returns 403, no match row inserted.
- Attempting to set `tournamentId` when the caller is not a member
  returns 403.

### Not adding e2e (Playwright) tests

M4's e2e suite already covers sign-in + match creation + leaderboards.
M5's flows are exercised by the Vitest integration tests against
real SQLite + by the manual smoke against the live cluster (see
verification §). A dedicated Playwright test of the join URL adds
operational complexity (a second Discord sandbox account) for
marginal additional coverage. If the reviewer disagrees, this is a
real point to push back on.

---

## File tree (commits 3 and 4 combined)

```
eloup-web/
├── lib/
│   ├── db/
│   │   └── migrations/
│   │       └── 0002_tournament_indexes.sql         [NEW]
│   ├── tournaments.ts                              [NEW]  CRUD + slug
│   ├── invites.ts                                  [NEW]  issue/consume/revoke
│   ├── tournament-standings.ts                     [NEW]  the standings SQL + types
│   ├── slug.ts                                     [NEW]  slugify + collision retry
│   └── permissions.ts                              [EDIT] adds isTournamentMember, isTournamentAdmin, updates canEditMatch
├── app/
│   ├── tournaments/
│   │   ├── page.tsx                                [NEW]  my-tournaments list
│   │   ├── new/page.tsx                            [NEW]  create form
│   │   ├── [slug]/page.tsx                         [NEW]  detail (standings + members + recent matches + inline admin)
│   │   └── join/[token]/page.tsx                   [NEW]  consume invite + redirect
│   ├── api/
│   │   ├── tournaments/route.ts                    [NEW]  POST create
│   │   └── tournaments/[slug]/
│   │       ├── invite/route.ts                     [NEW]  POST rotate, DELETE revoke
│   │       ├── members/[playerId]/route.ts         [NEW]  DELETE remove
│   │       └── admins/[playerId]/route.ts          [NEW]  PUT promote, DELETE demote
│   └── api/matches/route.ts                        [EDIT] accept optional tournamentId
├── components/
│   ├── BottomNav.tsx                               [EDIT] swap placeholder for live /tournaments link
│   ├── NewMatchForm.tsx                            [EDIT] add tournament picker; constrain participants when set
│   ├── TournamentStandings.tsx                     [NEW]  card-per-row mobile layout
│   ├── InviteCard.tsx                              [NEW]  admin-only; generate/copy/revoke
│   └── MemberRow.tsx                               [NEW]  shows promote/demote/remove only for admin viewer
└── tests/
    ├── unit/
    │   ├── permissions.test.ts                     [EDIT] +7 cases
    │   └── slug.test.ts                            [NEW]
    └── integration/
        ├── tournament-lifecycle.test.ts            [NEW]
        ├── tournament-match-and-standings.test.ts  [NEW]
        └── tournament-match-membership-guard.test.ts [NEW]

docs/tournaments.md                                 [EDIT] replace "TBD" prose with Q-TOURN-1..4 answers
symbols/manifest.json                               [EDIT] tournaments symbol: real values
symbols/manifest.lock                               [EDIT] regenerated
```

No wizard, k8s, or Dockerfile changes. The image rebuilds via the
existing wizard pipeline; no new env vars, no configmap changes, no
ingress changes.

---

## Commit shape

Mirrors M4's four-commit pattern.

1. **`docs: M5 — tournaments task doc`** — this file only. Lands now,
   unblocks the reviewer.
2. **`docs: M5 — reviewer report for tournaments`** — by a different
   agent (suggest `claude-sonnet-4-6-m5-reviewer`). The review-gate
   hook turns this from "blocked" to "allowed" for `eloup-web/` edits.
3. **`feat: eloup-web — tournament schema deltas + CRUD + invite engine + permissions + tests`**
   — server-side only. Migration 0002, `lib/tournaments.ts`,
   `lib/invites.ts`, `lib/slug.ts`, `lib/tournament-standings.ts`,
   `lib/permissions.ts` extensions, all five API routes,
   `/api/matches` extension, and all new Vitest tests. **No UI yet
   beyond the BottomNav stays disabled.** Alignment unchanged
   (no `symbols/` edits).
4. **`feat: eloup-web — tournament routes, standings UI, BottomNav wiring, symbol updates`**
   — three UI routes + the public join URL, the NewMatchForm
   tournament picker extension, BottomNav swap, `docs/tournaments.md`
   updates, `symbols/manifest.json` four property updates,
   `symbols/manifest.lock` regenerated. Alignment broken mid-edit (the
   doc and the symbol travel together in the same commit before `lock`
   runs); the post-`lock` state is aligned again.

Every commit ends with
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Verification before reporting done

1. `python3 scripts/align.py check` exits 0.
2. `cd wizard && python3 -m pytest -q` still passes — M5 should not
   touch the wizard at all. If it does, that's a regression.
3. `cd eloup-web && pnpm test` — Vitest passes. Expected: ~49 tests
   total (M4's 35 + ~14 new).
4. `cd eloup-web && pnpm lint && pnpm typecheck` clean.
5. `cd eloup-web && pnpm build` succeeds.
6. `docker build -t eloup-web-m5-test eloup-web/` succeeds.
7. **Local smoke** with `docker run` + a fresh `/data` mount + the M4
   env vars + an optional `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID`:
   - Sign in as a test Discord account.
   - Create a tournament ("Smoke Test").
   - Generate an invite, copy the URL.
   - Sign in as a second test account in a private window (or skip
     this step and document — see hand-off note below).
   - Hit the join URL, confirm membership.
   - Log a tournament-scoped match.
   - Confirm both rows, watch standings update.
   - As the second admin (after promote), revoke the invite link.
8. **Live smoke against tow-c1**: push commits → re-run wizard (phases
   5+6+7+9; phase 8 DNS is already done) → verify
   `https://eloup.kodloki.io/tournaments` renders on an iPhone Safari
   and the join URL flow works on a second device.

If the second test Discord account is unavailable, skip step 7's
multi-account flow and the iPhone half of step 8; report what was
verified single-account / single-device. Don't fabricate a passing
smoke.

---

## M5→M6 hand-off

Document at the bottom of this doc:

- The `bets` table is unused by M5. M6 fills it.
- The confirm-match transaction (`lib/db/match.ts`) is untouched by M5
  — M6 inserts the bet-settlement hook into the same `BEGIN IMMEDIATE`
  block. No M5 changes there.
- `overall_ratings.escrowed_elo` is still 0 everywhere; M5 never
  writes it. M6 writes from the placement endpoint.
- Tournament-scoped bets: M6 decides whether bets respect tournament
  membership / rating-pool isolation. M5's `matches.tournament_id`
  column is available for the M6 query. Q-TOURN-2 = shared pool means
  M6 has no "isolated tournament ELO" universe to settle into — bets
  always settle in the global overall ELO. M6's "self-bet legality"
  question (Q-BET-5) is unaffected by M5.
- The reveal gesture (Q-BET-1) is unchanged. M5's tournament views
  contain no betting UI.
- Standings UI: M6 may add a "open bets" column or a per-match betting
  indicator. M5's TournamentStandings component does not anticipate it
  (no placeholder slots) — M6 adds the columns when it adds the data.

---

## Out of scope for M5 (do NOT build)

- Bracketed formats (single elim, double elim, round robin, swiss) —
  deferred to a future M5b if needed.
- Tournament-scoped per-game ELO pool (Q-TOURN-2 = shared resolves it
  to no work).
- Per-invitee links, expiry timers, max-uses, join-requests — all
  deferred (the single-column model gates them on a future schema).
- A dedicated `/tournaments/[slug]/admin` route — inline controls
  cover it.
- Wizard changes, k8s changes, Dockerfile changes — none needed.
- Betting (M6).
- Heart-rate (M7).

---

## Open follow-ups (NOT blocking M5)

1. **Tournament archival.** `ends_at` is captured but does nothing in
   M5 — past-end tournaments still show in the list. A read-only
   `archived` flag + a filter on `/tournaments` is an obvious M6+
   follow-up.
2. **Public tournament discovery.** No mechanism for non-members to
   discover open tournaments. The 404-on-non-member access pattern
   above intentionally avoids slug enumeration; if discovery is a
   future feature it needs a `public` flag on the row.
3. **Invite link analytics.** Single column means no use-count, no
   "when was this rotated" — if those become interesting, the
   migration to the multi-token model is straightforward.
4. **Tournament-scoped leaderboard view in the global leaderboards
   page.** Out of scope for M5; the tournament's detail page is the
   only place per-tournament standings render today.

---

## Resolved review notes

The independent review at
`Agents/Review-reports/m5-tournaments-review.md` (verdict:
APPROVE WITH CHANGES) produced the following amendments to this plan.
Each item names the finding and the section that was edited.

1. **[MAJOR #1] Standings SQL overcounted casual matches.** The
   `match_participants` LEFT JOIN was anchored to `tm.player_id`
   independently of `matches`, so every confirmed match the player
   ever played counted toward the tournament's wins and
   matches_played. Verified broken with a `better-sqlite3` repro
   during review. §"Standings algorithm" now uses the corrected join
   order: `matches m` is the outer LEFT JOIN (filtered to the
   tournament + `status = 'confirmed'`), and `match_participants mp`
   joins *through* it on `mp.match_id = m.id AND mp.player_id =
   tm.player_id`. A note below the SQL warns that the order is not
   symmetric — the intuitive "join mp first" structure was the
   defect.

2. **[MAJOR #2] `canEditMatch` signature change had no enumerated
   callers.** The original plan said "verify in implementation,"
   which would have silently broken `pnpm typecheck` /
   `pnpm test` at compile time because three existing call sites in
   `tests/unit/permissions.test.ts` (lines 62/65/68) pass
   `matchCreatedBy` as a bare string. The §"Permissions extensions"
   section now lists those three lines explicitly and specifies the
   exact replacement shape. There are no production callers in
   `app/` or `components/` — the new signature is test-only break,
   but it's still a build-breaker without the test updates.

3. **[MINOR #3] Slug TOCTOU race had no plan-level mitigation.** Two
   concurrent creates with the same name could both pre-compute the
   same slug, both find it absent, then race the INSERT. SQLite's
   UNIQUE constraint guarantees one fails with
   `SQLITE_CONSTRAINT_UNIQUE`. The plan now specifies that
   `createTournament` catches that error, re-enters the slugify loop
   inside the transaction's catch, and bounds retries to 5 before
   surfacing a 409. A new test case in `slug.test.ts` exercises the
   catch path with a stubbed insert that throws on the first
   attempt.

4. **[MINOR #4] No test covered the HTTP-410 surface of a revoked
   invite token.** The integration test plan checked the data-layer
   invariant (`consumeInvite` returns `{status: 'invalid_token'}`)
   but not the user-visible failure mode — the
   `/tournaments/join/[token]` route handler's HTTP 410 response.
   The test plan now includes one additional integration test that
   invokes the route handler directly with a revoked token and
   asserts both the 410 status and the absence of a
   `tournament_members` insert.

5. **[NIT #5] `consumeInvite` return type was inconsistent across
   the plan.** Flow 3 said "returns the tournament row" on success;
   the test plan said `{status: 'invalid_token'}` on failure. Flow 3
   now declares the explicit signature
   `(db, token: string, playerId: string) => Tournament | { status: 'invalid_token' }`
   so the implementer and any future reader can find the discriminated
   union in one place. The route handler maps `{status: 'invalid_token'}`
   to HTTP 410.

### Things the reviewer explicitly verified (preserved here so a
future reader knows the plan's claims were independently checked):

- Schema fidelity: every column M5 uses exists exactly as
  `0001_init.sql` defines it.
- Partial-index syntax (`CREATE INDEX ... WHERE col IS NOT NULL`)
  works on the SQLite version `better-sqlite3` 11.3.0 bundles
  (SQLite 3.46+).
- `lib/db/match.ts` is correctly untouched under Q-TOURN-2 = shared.
  `upsertOverall` preserves `escrowed_elo` (M4 resolved review note
  #3); M5 does not disturb that.
- `NewMatchForm.tsx` currently sends `{gameId, participants}` — the
  planned `tournamentId` extension is additive and backwards-compatible
  with the existing Zod schema in `/api/matches`.
- No wizard / k8s / Dockerfile / env-var / configmap changes are
  required. The `APP_RUNTIME_SECRET_KEYS` set is unchanged.
- Independent Review Rule: `claude-opus-4.7-m5-implementer` (author)
  vs `claude-sonnet-4-6-m5-reviewer` (reviewer) — different agents.
