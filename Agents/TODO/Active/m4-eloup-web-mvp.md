# M4 — EloUp web app MVP: auth, schema, ELO, match flows, leaderboards, PWA

## Author: claude-opus-4.7-m4-implementer
## Status: Not Started

> Implementation plan for milestone M4 of `project-review-and-plan.md` (§4.2
> "EloUp Web App"). Lands the actual Next.js application that the M0→M3
> pipeline has been deploying against placeholder images (currently
> `grafana/grafana:latest` per `K8s/statefulset-web.yaml:23`). Honors the
> M3→M4 hand-off contract in `m3-wizard-phases-6-9.md` §"M3→M4 hand-off
> contract" — M4 ships an `eloup-web/Dockerfile` listening on port 3000
> with `/api/health`; the wizard reruns and the image flips over.
>
> M4 also makes **one targeted wizard change**: adding
> `nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"` to the ingress
> template in `wizard/wizard/phases/_manifests.py` so the first OAuth
> callback doesn't 502 on the default nginx buffer. This is the only
> wizard touch in M4 and is isolated to its own commit per
> review-incorporation note 5 below.
>
> Per the M2/M3 reviewer's "commit 1 is task doc only" pattern: this doc
> + the one-line review-gate hook extension are commit 1. The reviewer
> commits their report separately as commit 2. Implementer's feature
> commits become commits 3, 4, 5 (engine; wizard ingress fix; UI/PWA).
>
> **Author/Reviewer separation note.** Prior authors include
> `claude-opus-4.7-planner`, `…-m2-implementer`, `…-m3-implementer`;
> prior reviewers `claude-sonnet-4-6-reviewer`, `…-m2-reviewer`,
> `…-m3-reviewer`. The reviewer for this doc must use a `## Reviewer:`
> field distinct from `## Author: claude-opus-4.7-m4-implementer`, per
> the review gate's self-review rule.
>
> **Review-incorporation note (2026-05-15):** the independent review at
> `Agents/Review-reports/m4-eloup-web-mvp-review.md` raised 4 [MAJOR] +
> 4 [MINOR] + 3 [NIT] findings. Sections below have been amended where
> the review changed the plan; "Resolved review notes" at the bottom
> records what changed and why.

---

## Scope

Build the EloUp web application — Discord OAuth, players + games +
matches schema, per-game + overall ELO, leaderboards, PWA install hint —
inside a new `eloup-web/` directory at the repo root. Phase 5 of the
wizard auto-detects this layout via
`wizard/wizard/phases/build_images.py:_resolve_eloup_web_spec`
(`workspace/eloup-web/Dockerfile`); no wizard edits needed.

**Out of scope** (each will land as its own per-milestone task doc):

- **Tournaments (M5).** Schema columns exist in this MVP's
  `0001_init.sql`, the `tournament_admin` role enum value exists in the
  `players.role` CHECK constraint, and the bottom-nav reserves a slot
  — but no tournament CRUD, no invite-token flow, no admin-issuance UI.
- **Hidden ELO-betting (M6).** `bets` table + `overall_ratings.escrowed_elo`
  column ship in `0001_init.sql` so M6 doesn't need a migration to start
  writing rows. No reveal gesture, no placement UI, no settle-on-confirm
  step in the M4 transaction.
- **Heart-rate / Pi service / projection view (M7).** Deferred until
  KYTO docs land.
- **Backups, log shipping, monitoring beyond `/api/health`.** Listed as
  open follow-ups at the bottom; not in M4.
- **Wizard changes.** M4 makes **one** wizard edit per resolved review
  note 5: adding `nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"`
  to the ingress template in `wizard/wizard/phases/_manifests.py`
  (commit 4 below). Rationale: Next.js + Auth.js v5 + Discord OAuth
  sends large `Set-Cookie` + state-token headers on the callback;
  default nginx buffers 502 the response. This must be in the manifest
  from day-one for sign-in to work. The wizard touch is isolated to a
  single annotation + its corresponding test. The other "wizard-adjacent"
  M4 edit — `.claude/hooks/require-review.sh` — is in commit 1.

---

## Workflow gate — review-gate hook extension (in commit 1)

The review-gate hook at `.claude/hooks/require-review.sh:34` only matches
file paths containing `/src/`, `/k8s/`, `/scripts/`, or `/config/`. The
M4 brief and `CLAUDE.md` both claim `eloup-web/` is gated, but the hook
as written does NOT block it. To match the documented promise (and to
protect M5/M6 implementers who will reasonably trust `CLAUDE.md`),
commit 1 extends the case statement:

```diff
 case "$FILE_PATH" in
-    */src/*|*/k8s/*|*/scripts/*|*/config/*) ;;
+    */src/*|*/k8s/*|*/scripts/*|*/config/*|*/eloup-web/*) ;;
     *) exit 0 ;;
 esac
```

The hook itself lives outside `src/k8s/scripts/config/` (it's in
`.claude/hooks/`), so the gate does not block this edit. CLAUDE.md is
also updated in the same commit to mention `eloup-web/` explicitly in
the "source file edits" paragraph so future readers see the same
contract documented and enforced.

This patch is tiny and uncontroversial; bundling it with the task doc
keeps commit 2 (review) and commits 3–4 (implementation) under the same
strict gate. Reviewer: please verify the patch in commit 1.

---

## Confirmed open questions (defaults accepted)

The M4 brief flagged these as worth resolving in the task doc. Defaults
accepted unless noted:

| Question | Decision |
|---|---|
| **Q-RATE-2** team-match ELO formula | **(a) team-average rating, equal delta to each member.** Simplest, matches user expectations for a casual-party app. Recorded as `rating.team_match_formula = "team_average_equal_delta"` symbol property in commit 4. |
| **Q-RATE-3** FFA pairwise with K/(n−1) | **Kept.** Already in `docs/rating.md`; not overridden. |
| **Q-RATE-4** per-game ELO before first match | **Lazy.** Insert a `ratings` row at first match with `rating_before = 1200`. No pre-creation on signup. Cheaper write path and a player who never plays a game gets no row. |
| **Q-APP-1** PWA install prompt | **Proactive on first authenticated load.** Android: native `beforeinstallprompt` captured + replayed via a banner. iOS: custom share-sheet hint when `navigator.standalone === false`. Dismiss state in `localStorage["eloup.install.dismissed"]` (UA-keyed so dismissing on iOS doesn't suppress on Android). |
| **Q-APP-2** offline behavior | **Read-only cached leaderboards.** SW caches the app shell + the JSON response of `GET /api/leaderboards` (stale-while-revalidate). Writes always require network — no offline queue. |
| **Q-AUTH-3** admin bootstrap | **(a) `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` env var.** First matching login is promoted to `global_admin`. Promotion is idempotent (re-running with the same env var on an existing global_admin is a no-op). No `_EMAIL` fallback — emails are mutable, snowflakes aren't. Operator looks up their snowflake once via Discord Developer Mode. **Operator supply mechanism**: the env var is NOT wired through the wizard (the wizard's configmap renders only the three keys named in the M3 contract; `APP_RUNTIME_SECRET_KEYS` is exactly `{discord_client_secret, app_session_secret}`). After the StatefulSet is Healthy, the operator runs `kubectl -n eloup set env statefulset/eloup-web ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID=<snowflake>`; the pod restarts and the var is read at first matching sign-in. Subsequent logins ignore it (the `players.role='global_admin'` row is the authoritative state). Documented in `docs/app.md`. |

**Q-APP-3** (UI library) and stack additions decided by the M4 prompt
discussion: **shadcn/ui + Tailwind for UI; better-sqlite3 direct (no
ORM) for DB; Auth.js v5 for OAuth; hand-rolled service worker + manifest
for PWA.** Rationales in §"Library picks" below.

**Q-APP-4** (anonymous viewers): leaderboards public; everything else
requires sign-in. Matches the brief's default.

---

## Library picks (with rationale)

| Pick | Alternative considered | Why this |
|---|---|---|
| **Next.js 15 (App Router)** | Next.js 14 | 15 has stable App Router, async Request APIs, and the `next/headers` cookies/headers helpers needed by Auth.js v5. 14 would work; 15 has no relevant regressions and matches what new projects ship with today. |
| **TypeScript strict** | non-strict | Catches schema↔code drift early. `// reason:` comment required for any `any`. |
| **Auth.js v5 (`next-auth@5`)** | next-auth@4 | v5 is the App-Router-native rewrite (out of beta as of late 2025). The brief calls for it. Built-in Discord provider, JWT sessions out of the box. |
| **`better-sqlite3` direct + prepared statements** | drizzle-orm, Kysely | Single-replica SQLite + ~10 distinct queries: an ORM's type-safety win doesn't outweigh the extra dep + codegen step. The schema is a single SQL file the reviewer can read end-to-end. Per CLAUDE.md "no premature abstractions." |
| **Versioned `.sql` files in `lib/db/migrations/`** | drizzle-kit migrate, Prisma migrate | One SQL file for M4; M5 adds `0002_tournaments.sql`. Migrator is ~30 lines (read sorted files, skip already-applied versions, exec inside `BEGIN IMMEDIATE`). Single-replica StatefulSet → no need for lock coordination beyond `BEGIN IMMEDIATE`'s reservation. |
| **shadcn/ui** | Radix Primitives direct, Mantine, Chakra | Components copy into `eloup-web/components/ui/`, no runtime dep, full Tailwind control. Brief default. |
| **Hand-rolled service worker + `public/manifest.webmanifest`** | `next-pwa`, `@serwist/next` | `next-pwa` lags Next.js App Router; `@serwist/next` is a community fork. Our SW caches the app shell + one JSON endpoint — that's ~40 lines we can read. No plugin to upgrade alongside Next.js. |
| **`zod` for env-var validation** | `valibot`, no validation | Env-var schema at startup catches missing `DISCORD_CLIENT_SECRET` early. Used in two places (env validation + maybe a few API route bodies), small footprint. |
| **Vitest** for unit tests | Jest, node:test | Native ESM, no `ts-jest` dance, fast. Brief calls for it. |
| **Playwright** for the optional E2E | Cypress, manual | One golden-path test only — sign-in → log match → confirm → leaderboard updates. Will be marked `@e2e` and skipped in CI's unit-test run; runs locally against a seeded ephemeral SQLite. |

All choices captured in the `app` symbol added in commit 4 — see
§"Symbol updates" below.

---

## File tree (under `eloup-web/`)

```
eloup-web/
├── Dockerfile                          multi-stage: deps → build → runtime; final UID 1000, port 3000
├── .dockerignore                       excludes node_modules, .next, .git, tests
├── package.json                        pnpm, Node ≥ 20, scripts: dev/build/start/lint/typecheck/test
├── pnpm-lock.yaml                      checked in (deterministic builds)
├── tsconfig.json                       strict, target ES2022, moduleResolution bundler, paths "@/*"
├── next.config.mjs                     output: 'standalone'; serverActions; experimental.typedRoutes
├── tailwind.config.ts                  scans app/**/*.{ts,tsx}, components/**/*.tsx; safe-area utilities
├── postcss.config.mjs                  tailwindcss + autoprefixer
├── .eslintrc.cjs                       next/core-web-vitals + tailwindcss/recommended
├── .prettierrc                         empty {} (defaults) — uniform formatting
├── vitest.config.ts                    node env; testEnvironment "node"; setupFiles for DB temp dir
├── playwright.config.ts                webServer: next dev; testDir: e2e/
├── public/
│   ├── manifest.webmanifest            display: standalone, theme color, scope /, start_url /
│   ├── sw.js                           hand-rolled SW (app shell precache + leaderboard SWR)
│   ├── icon-192.png                    maskable
│   ├── icon-512.png                    maskable
│   ├── icon-mono-192.png               monochrome (for the iOS dynamic-island tinting + Android theme)
│   └── apple-touch-icon.png            180x180, iOS-required
├── app/
│   ├── layout.tsx                      RootLayout: <html lang>, theme-color meta, sw registration script, <SessionProvider>, <BottomNav>
│   ├── globals.css                     Tailwind base/components/utilities; :root vars incl --safe-bottom
│   ├── page.tsx                        permanent redirect to /leaderboards
│   ├── leaderboards/
│   │   └── page.tsx                    server component; per-game tabs + overall; public access
│   ├── matches/
│   │   ├── page.tsx                    auth-gated; pending + recent confirmed for signed-in player
│   │   ├── new/page.tsx                auth-gated; game-picker → participants → placements → submit
│   │   └── [id]/page.tsx               auth-gated; confirm-my-row CTA + per-row status table
│   ├── profile/
│   │   └── page.tsx                    auth-gated; overall + per-game ratings + recent matches
│   ├── games/
│   │   └── page.tsx                    global_admin only; CRUD on games catalog
│   └── api/
│       ├── health/route.ts                          GET → 200 {ok:true} after SELECT 1; not auth-gated
│       ├── auth/[...nextauth]/route.ts              Auth.js v5 handlers
│       ├── leaderboards/route.ts                    GET → JSON; cached by SW; public
│       ├── matches/route.ts                         POST → create match (caller authed)
│       ├── matches/[id]/confirm/route.ts            POST → confirm caller's row (last row triggers ELO tx)
│       └── games/route.ts                           GET public; POST/PATCH global_admin only
├── components/
│   ├── BottomNav.tsx                   client; pinned bottom, 44px tap targets, safe-area-inset-bottom padding
│   ├── InstallHintIOS.tsx              client; iOS Safari only; one-time dismiss via localStorage
│   ├── InstallHintAndroid.tsx          client; captures + replays beforeinstallprompt
│   ├── PlacementInput.tsx              client; per-participant placement spinner
│   ├── ParticipantPicker.tsx           client; search players by handle/display_name
│   ├── ConfirmRowButton.tsx            client (server action wrapper); triggers PATCH /api/matches
│   └── ui/                             shadcn copies — Button, Input, Dialog, Tabs, etc.
├── lib/
│   ├── env.ts                          zod schema: required → DISCORD_CLIENT_ID/SECRET, APP_SESSION_SECRET, APP_DOMAIN, DATABASE_PATH; optional → ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID (z.string().optional()); throws at module import if any required field is invalid
│   ├── auth.ts                         Auth.js v5 config: Discord provider, signIn callback (rejects unverified), jwt/session callbacks, bootstrap-admin promotion
│   ├── permissions.ts                  can_confirm_row(player, row), can_create_game(player), can_edit_match(player, match)
│   ├── elo.ts                          PURE: computeMatchDeltas(participants, outcomes, k) → Map<playerId, delta>
│   ├── db/
│   │   ├── client.ts                   opens better-sqlite3 at DATABASE_PATH; PRAGMA journal_mode=WAL, foreign_keys=ON; calls applyMigrations() once at module load
│   │   ├── migrate.ts                  reads migrations/*.sql sorted; BEGIN IMMEDIATE; skip already-applied versions; commit
│   │   ├── queries.ts                  named, prepared-statement query helpers: getPlayerById, listGames, etc.
│   │   ├── match.ts                    confirmRow(matchId, playerId): the atomic ELO transaction (see Phase D)
│   │   └── migrations/
│   │       └── 0001_init.sql           every table from §4.2 of the plan, exactly
│   ├── pwa/
│   │   └── register-sw.ts              client; registers /sw.js once on mount
│   └── util/
│       ├── format.ts                   formatRating(n), formatRelativeTime(ts)
│       └── ids.ts                      crypto.randomUUID-based id minting for inserts
├── tests/
│   ├── unit/
│   │   ├── elo.test.ts                 1v1, team (Q-RATE-2 default), FFA pairwise, floor clamp
│   │   ├── permissions.test.ts         can_confirm_row matrix for owner/admin/stranger
│   │   └── migrate.test.ts             applyMigrations on fresh DB; re-apply is a no-op; resumes after partial failure
│   └── integration/
│       ├── confirm-match.test.ts       real ephemeral SQLite; insert match + participants; confirm rows; assert rating writes
│       └── bootstrap-admin.test.ts     real ephemeral SQLite; env var set; first matching insert promotes
└── e2e/
    └── golden-path.spec.ts             Playwright; @e2e tag; skipped in CI unit-runs
```

I can defend every top-level entry. One judgement call:

- **`pnpm` over `npm`/`yarn`.** Faster installs, deterministic via
  `pnpm-lock.yaml`, smaller node_modules due to content-addressed store.
  Brief doesn't pin a package manager; pnpm is what most new Next.js
  projects use in 2026. The Dockerfile's `deps` stage uses
  `corepack enable && pnpm install --frozen-lockfile`.

(The earlier `app/install-hint/page.tsx` debug route was dropped per
resolved review note 10 — the install-hint component renders inside
the layout and is tested via Vitest snapshot + Playwright, so a
dedicated debug route adds no value.)

---

## DB migration strategy

`lib/db/migrate.ts` runs at module import of `lib/db/client.ts`. Sequence:

```
1. CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT)
2. SELECT max(version) FROM schema_migrations
3. List lib/db/migrations/*.sql sorted lexicographically.
   Each filename is `NNNN_name.sql` where NNNN parses to int.
4. For each file with version > max:
     BEGIN IMMEDIATE
     execute the SQL (multiple statements; better-sqlite3 `.exec()` supports this)
     INSERT INTO schema_migrations VALUES (version, datetime('now'))
     COMMIT
   (try/catch around the BEGIN: if a concurrent process holds the lock,
   sleep 100ms and retry up to 30 times. Single-replica StatefulSet
   means concurrent runs are pathological — but a re-imported module
   inside one process could race itself, so a guard module-level
   `applied = false` flag prevents that.)
5. Module-level export: db instance, ready to query.
```

**Why `BEGIN IMMEDIATE` and not `BEGIN DEFERRED`:** an IMMEDIATE
transaction acquires the RESERVED lock at start, so two concurrent
migrators can't both think they're applying version N+1 and double-apply.
DEFERRED only acquires when the first write happens — too late.

**Why one file per migration:** smaller diffs, easier to bisect a
"this migration broke prod" failure. The single M4 file (`0001_init.sql`)
contains the entire schema.

**DDL nullability** (clarifies the §4.2 schema sketch, per resolved
review note 4):

- `match_participants.rating_before REAL NULL` and `rating_delta REAL
  NULL` — inserted as NULL at match creation, filled at confirm time
  by Flow 4's transaction. The DDL must declare them nullable
  explicitly; the §4.2 sketch's "rating_before, rating_delta" without
  annotation is ambiguous but the intent (per Flow 3/4) is nullable.
- `match_participants.team_label TEXT NULL`, `placement INTEGER NULL`,
  `score REAL NULL`, `confirmed_at TEXT NULL` — also nullable.
- `ratings(player_id, game_id)` is a composite PRIMARY KEY (or UNIQUE
  on the pair) so the `ON CONFLICT(player_id, game_id)` upsert in Flow
  4 resolves.
- `overall_ratings.player_id` is PRIMARY KEY (one row per player) so
  the `ON CONFLICT(player_id)` upsert resolves.
- `overall_ratings.escrowed_elo NUMERIC NOT NULL DEFAULT 0` and the
  CHECK constraint `current_rating >= 0` per Q-BET-2 (umbrella plan
  §4.2). Both are non-negotiable.

**Why no rollback:** SQLite doesn't have built-in down-migrations; a
"reverse" .sql file is risky on a real prod database with rows.
Rolling back M4's `0001_init.sql` would mean dropping the whole DB,
which is exactly what restoring a backup does. M5/M6 add columns and
tables; M7+ rarely need destructive rollback. KISS.

---

## ELO function signatures

`lib/elo.ts` is pure — no I/O, no side effects, no DB access. Easy to
test in isolation; the apply-deltas-to-DB step lives separately in
`lib/db/match.ts`.

```ts
export type Participant = {
  playerId: string;
  ratingBefore: number;
  teamLabel?: string; // present iff format === 'team'
};

export type Outcome = {
  playerId: string;
  placement: number; // 1 = winner; ties allowed
};

export type Format = '1v1' | 'team' | 'ffa';

export function computeMatchDeltas(
  participants: Participant[],
  outcomes: Outcome[],
  format: Format,
  k: number,
): Map<string, number>;
```

Three branches inside, dispatched on `format`:

1. **`1v1`** — `Participant.length === 2`. Standard ELO:
   `expected_a = 1 / (1 + 10^((rating_b - rating_a)/400))`. Winner gains
   `k * (1 - expected_a)`; loser loses the symmetric amount. Ties:
   each player gets `k * (0.5 - expected_a)`.
2. **`team`** — group `participants` by `teamLabel` (Q-RATE-2 default
   (a)). Compute a team-average rating per team. Apply 1v1 ELO between
   team averages. Every member of the winning team gets `+delta`; every
   member of the losing team gets `−delta`. Ties → each member gets the
   tied amount. Asserts: exactly two teams; each player has a non-null
   `teamLabel`.
3. **`ffa`** — `Participant.length >= 2`, no teams. For each unordered
   pair `(a, b)` where `placement_a < placement_b` (a finished better),
   compute the 1v1 update with effective K = `k / (n − 1)` (Q-RATE-3
   kept). Sum all per-pair deltas per player. Final map is the sum.

**Floor at 0** is NOT in `lib/elo.ts` — it's an apply-layer concern.
`computeMatchDeltas` returns the raw delta; `lib/db/match.ts` clamps
`overall_ratings.current_rating + delta` to `max(0, …)` before writing.
Keeps the pure function pure (a delta of −500 against a current rating
of 100 yields a clamp of 100, not a clamp of −400, so the clamp needs
the current_rating to make sense).

Per-game ratings have no floor — they can dip below 0 in theory, but
practically ELO doesn't trend toward 0 for active players. If we later
decide per-game also floors at 0, that's a one-line apply-layer change.

Per resolved review note 9, `lib/db/match.ts` includes a
single-line comment immediately above the per-game upsert: `// per-game
ratings are intentionally NOT floored at 0 — only overall_ratings is
(Q-RATE/floor symbol property). Do NOT add a clamp here without
updating docs/rating.md + the rating symbol.` This stops a future
M5/M6 implementer from "fixing" the missing clamp.

---

## Route table

Every route is server-rendered (Next.js App Router server component) by
default; client islands marked. Auth boundary per row.

| Route | Method | Auth | Description |
|---|---|---|---|
| `/` | GET | anonymous | 308 redirect → `/leaderboards` |
| `/leaderboards` | GET | **anonymous** (Q-APP-4 default) | tabs: Overall + each game; top-N by `current_rating DESC` |
| `/matches` | GET | user | pending + recent confirmed for signed-in player |
| `/matches/new` | GET | user | game-picker → participant-picker → placements → submit |
| `/matches/[id]` | GET | user | participant list + confirm-my-row CTA |
| `/profile` | GET | user | overall + per-game ratings + recent match history |
| `/games` | GET | **global_admin** | CRUD on games catalog |
| `/api/health` | GET | anonymous | `SELECT 1` against DB; `200 {ok:true}` or `503` |
| `/api/auth/*` | various | Auth.js v5 | OAuth handlers; managed by next-auth |
| `/api/leaderboards` | GET | anonymous | JSON; SW caches this with SWR |
| `/api/matches` | POST | user | create match (`status='pending'` per Q-AUTH-2) |
| `/api/matches/[id]/confirm` | POST | user (must own row) | flip the caller's row to confirmed; if last → run ELO transaction |
| `/api/games` | GET | anonymous | catalog; consumed by `/matches/new` |
| `/api/games` | POST/PATCH | global_admin | add/edit games |

**Auth boundary enforcement** lives in two places:
1. `middleware.ts` (Next.js convention) rejects unauthenticated traffic
   to `/matches/*`, `/matches/new`, `/profile`, `/games`, `/api/matches/*`,
   `/api/games` (mutations). Returns 401 for `/api/*`, 302 → `/api/auth/signin?callbackUrl=…`
   for HTML routes.
2. **Per-route role checks** for `global_admin`-only routes
   (`/games`, mutating `/api/games`) inside the route handler — middleware
   confirms there's a session, the handler confirms the role. Belt-and-
   suspenders; keeps the role check next to the action it protects.

`can_*` helpers in `lib/permissions.ts` are pure functions over
`(session, target)` so they're testable without HTTP.

---

## The 5 must-work flows

### Flow 1 — Discord sign-in + first-login bootstrap (+ admin promotion)

User taps "Sign in with Discord" on the home redirect. Browser →
`/api/auth/signin/discord` → Discord OAuth consent (scopes `identify
email`) → Discord redirects back to `/api/auth/callback/discord`. The
Auth.js v5 `signIn({profile})` callback runs:

1. If `profile.verified !== true` → return `false` (Q-AUTH-4: reject
   unverified). User sees Auth.js's default error page.
2. Else: inside a single `BEGIN IMMEDIATE` transaction, `SELECT * FROM
   players WHERE discord_id = ?`. If absent, INSERT a new row with
   `role='user'`, `discord_id`, `discord_handle`, `display_name`,
   `email`, `email_verified=1`, `avatar_url`, `created_at=datetime('now')`.
3. If `env.ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID === profile.id`, UPDATE
   `players.role = 'global_admin'` for this row. Idempotent — running
   the same env var against an existing global_admin is a no-op.
4. COMMIT.

The `jwt({token, account, profile})` callback fires next. On
first-call-per-session (account is non-null), look up the player by
`discord_id`, attach `token.playerId = row.id` and `token.role = row.role`.
The `session({session, token})` callback copies both onto `session.user`.

State user sees: redirected to `/leaderboards` (or `callbackUrl`). The
BottomNav now shows their avatar in the Profile slot. Subsequent
requests carry the JWT cookie; server components do `await
auth()` to get the session.

### Flow 2 — global_admin adds a game

global_admin loads `/games`. The page lists existing games (read via
`listGames()` query helper) and shows an "Add game" form (shadcn Dialog).
Submitting the form POSTs to `/api/games` with `{name, slug, default_k,
format, min_participants, max_participants}`. The handler:

1. `await auth()` → require `role === 'global_admin'` (return 403 otherwise).
2. zod-validate the body.
3. INSERT INTO games. Slug uniqueness enforced by `UNIQUE` constraint
   in `0001_init.sql`. A duplicate returns 409.
4. Revalidate `/leaderboards` and `/matches/new` (these render the games
   list) via `revalidatePath`.

User sees: dialog closes, table updates with the new row.

### Flow 3 — Any user logs a match result post-hoc

Signed-in user taps the (+) FAB on `/matches` → `/matches/new`.
Game-picker (segmented control of catalog) → ParticipantPicker (search
input + autocomplete against `players.discord_handle` and
`players.display_name`; you can add yourself if you participated) →
PlacementInput rows (one per participant; placement integer required,
optional score). Submit POSTs to `/api/matches`:

1. `await auth()` → require session.
2. zod-validate: at least `game.min_participants` and at most
   `game.max_participants` rows; placements form a valid ranking
   (allow ties); team-format matches require `teamLabel` on every row.
3. Inside `BEGIN IMMEDIATE`:
   - INSERT INTO matches with `status='pending'`, `created_by=session.playerId`,
     `created_at=datetime('now')`.
   - For each participant: INSERT INTO match_participants with
     `confirmed_at = NULL`, `rating_before = NULL` (filled at confirm
     time), `rating_delta = NULL`. EXCEPT: the creator's own row,
     if they were a participant, has `confirmed_at = datetime('now')`
     because they're vouching for the data at submission time.
4. COMMIT.

Per Q-AUTH-2 default (all-participants confirmation): the match stays
`pending` until every row is `confirmed`. User sees: redirected to
`/matches/[id]` showing the participant list, their own row marked
"confirmed (you)" and the rest "awaiting confirmation."

### Flow 4 — A participant confirms their row → ELO update

A participant who didn't create the match opens `/matches/[id]` (via a
link they got, or via the "Pending matches" list on `/matches`). They
see the participant grid; their own row has a green "Confirm" button.
They tap it. The button calls a server action that POSTs to
`/api/matches/[id]/confirm`:

1. `await auth()` → require session.
2. `can_confirm_row(session.playerId, matchId)` → returns true iff the
   caller's own row in `match_participants` exists with `confirmed_at IS
   NULL`. Returns 403 otherwise.
3. Open `BEGIN IMMEDIATE`. Re-check (race condition guard):
   `SELECT confirmed_at FROM match_participants WHERE match_id = ? AND
   player_id = ?`. If non-null, ROLLBACK and return 200 (idempotent —
   user double-tap is fine).
4. UPDATE match_participants SET confirmed_at = datetime('now') for
   this row.
5. `SELECT COUNT(*) FROM match_participants WHERE match_id = ? AND
   confirmed_at IS NULL` → if > 0, COMMIT and return 200 with `{status:
   'pending'}`.
6. If 0 (this was the last unconfirmed row): run the ELO transaction:
   - SELECT all rows for this match with their `ratings.current_rating`
     (LEFT JOIN — null if no row yet → use 1200 default).
   - Compute per-game deltas via `computeMatchDeltas(participants,
     outcomes, game.format, game.default_k)`.
   - Compute overall-ELO deltas via the same function with
     `OVERALL_K = 32` and `OVERALL_START = 1200` (from manifest), using
     `overall_ratings.current_rating` for `ratingBefore` (1200 if no row).
   - For each participant:
     - UPDATE match_participants SET rating_before = X, rating_delta = D.
     - Upsert per-game rating (clamp NOT applied per-game — see
       resolved review note 9):
       ```sql
       INSERT INTO ratings(player_id, game_id, current_rating, games_played, last_match_id)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(player_id, game_id) DO UPDATE SET
         current_rating = excluded.current_rating,
         games_played   = ratings.games_played + 1,
         last_match_id  = excluded.last_match_id
       ```
       The supplied `current_rating` in the VALUES tuple is the
       already-summed `current + delta` (computed in app code).
     - Upsert overall rating (clamp at 0; **`escrowed_elo` MUST be
       preserved** — omitted from both the INSERT tuple and the
       conflict-update SET so the column either takes its DEFAULT (0)
       on first insert or stays untouched on conflict):
       ```sql
       INSERT INTO overall_ratings(player_id, current_rating, last_match_id)
       VALUES (?, MAX(0, ?), ?)
       ON CONFLICT(player_id) DO UPDATE SET
         current_rating = MAX(0, excluded.current_rating),
         last_match_id  = excluded.last_match_id
       ```
       Q-BET-2 reserved `escrowed_elo` for M6; the M4 confirm
       transaction must NEVER overwrite it. Tested in
       `confirm-match.test.ts` by seeding a non-zero `escrowed_elo`
       before confirming, then asserting the same value post-confirm.
   - UPDATE matches SET status = 'confirmed', ended_at =
     coalesce(ended_at, datetime('now')).
7. COMMIT. Revalidate `/matches`, `/matches/[id]`, `/leaderboards`.

User sees: row flips to "confirmed (you)"; if last, the page rerenders
with per-row `rating_before`/`rating_delta` visible and a "Match
confirmed — ELO updated" toast. They can tap "Leaderboards" in
BottomNav to see their new ranking.

**Bet settlement note** — Q-BET-2 reserved
`overall_ratings.escrowed_elo` and the `bets` table. M4's confirm
transaction does NOT settle bets (no rows to settle yet). M6 slots in
by adding a bet-settlement step inside this transaction.

### Flow 5 — Anyone views leaderboards

Anonymous or signed-in user lands on `/leaderboards`. Server-rendered
page reads:

- `SELECT id, name, slug FROM games ORDER BY name`
- For each game (lazy in the UI, but pre-fetched for the active tab):
  `SELECT p.discord_handle, p.display_name, p.avatar_url,
   r.current_rating, r.games_played FROM ratings r JOIN players p ON
   p.id = r.player_id WHERE r.game_id = ? ORDER BY r.current_rating
   DESC LIMIT 50`
- Overall tab: `SELECT p.discord_handle, p.display_name, p.avatar_url,
   o.current_rating FROM overall_ratings o JOIN players p ON p.id =
   o.player_id ORDER BY o.current_rating DESC LIMIT 50`

The `/api/leaderboards` route returns the same data as JSON; the SW
caches it for offline read (Q-APP-2 default). The page uses Tabs
(shadcn) with the Overall tab default-selected. Tab switching is
client-side (URL param `?tab=<slug>` so links are shareable).

Indexes that make this fast:
- `CREATE INDEX idx_ratings_game_rating ON ratings(game_id, current_rating DESC)`
- `CREATE INDEX idx_overall_rating ON overall_ratings(current_rating DESC)`

User sees: per-tab ranking table with avatars + handles + ratings.
Anonymous users get a "Sign in with Discord" CTA in the BottomNav slot
where their avatar would be.

---

## Test plan

**Mandatory** (gates the merge):

- `tests/unit/elo.test.ts` — `computeMatchDeltas`:
  - 1v1 with equal ratings → ±16 (K=32, expected=0.5).
  - 1v1 with 1400 vs 1200 → expected ≈ 0.76; winner gets ≈ 7.7,
    loser ≈ −7.7. Symmetry assertion.
  - team 2v2 (A1=1200, A2=1300; B1=1100, B2=1400) → averages 1250 vs
    1250 → tie ELO update; assert each member of winning team gets the
    same delta.
  - FFA 4-player: K = 32/(4−1) ≈ 10.67. Winner finishes 1st against
    all 3; sum their pairwise deltas; assert symmetric loser deltas.
  - Floor clamp (apply-layer, tested in `confirm-match.test.ts`):
    current_rating=10, computed delta=−500 → new=0 not −490.
- `tests/unit/permissions.test.ts`:
  - `can_confirm_row(session, row)`: own row + unconfirmed → true.
  - same row already confirmed → false (idempotent caller should bail
    before the transaction).
  - other player's row → false (regardless of role — only global_admin
    edit-any-match scope, see Q-AUTH-2 default keeping all-participant
    confirmation).
  - `can_create_game`: only global_admin → true.
- `tests/unit/migrate.test.ts`:
  - Fresh DB: applyMigrations → all tables exist, `schema_migrations`
    has version 1.
  - Re-run on same DB: no INSERTs, no errors, schema_migrations
    unchanged.
  - Partial-run recovery: write `schema_migrations(0)` only, no tables;
    applyMigrations runs 1 normally (because 1 > 0).
- `tests/integration/confirm-match.test.ts`:
  - Real ephemeral SQLite (one file per test in `os.tmpdir`).
  - Insert game + 2 players + match + 2 participants (1 pre-confirmed
    by creator, 1 pending).
  - POST to the confirm-row code path (call the handler function
    directly with a mocked session).
  - Assert: per-game `ratings.current_rating` shifted by ±expected
    delta; `overall_ratings.current_rating` shifted; `matches.status
    = 'confirmed'`; both `match_participants.rating_before` and
    `rating_delta` populated; idempotent re-POST returns 200 without
    re-updating ratings.
- `tests/integration/bootstrap-admin.test.ts`:
  - Real ephemeral SQLite + `env.ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID = 'abc'`.
  - Simulate signIn for `profile.id = 'abc'` → assert `players.role
    = 'global_admin'`.
  - Simulate signIn for `profile.id = 'xyz'` → assert `players.role
    = 'user'`.
  - Run the same `signIn('abc')` a second time → assert role stays
    `global_admin`, no errors, no duplicate insert.

**Optional but recommended** (not gating, but I'll write one):

- `e2e/golden-path.spec.ts` — Playwright:
  - Stub Discord OAuth (Auth.js v5 supports a custom credentials
    provider in test config). Two test users.
  - Sign in as user 1, log a 1v1 match (user 1 vs user 2), confirm
    user-1 row at submit time (creator).
  - Sign in as user 2, navigate to /matches, confirm the pending row.
  - Assert /leaderboards rendering shows both players with non-1200
    ratings.

**No mocks at the boundary the test should verify** — per CLAUDE.md and
the brief. The DB layer is tested against a real SQLite file. The
OAuth network is mocked (we can't hit Discord from CI), but the DB
writes/reads are real.

---

## PWA install strategy

**Manifest** (`public/manifest.webmanifest`):

Per resolved review note 8, `"purpose": "any maskable"` is non-standard
and penalized by Lighthouse — split into separate entries (one `any`,
one `maskable`) per W3C App Manifest spec:

```json
{
  "name": "EloUp",
  "short_name": "EloUp",
  "description": "Multi-game ELO tracker for parties",
  "display": "standalone",
  "scope": "/",
  "start_url": "/leaderboards",
  "theme_color": "#0f172a",
  "background_color": "#0f172a",
  "icons": [
    { "src": "/icon-any-192.png",  "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-any-512.png",  "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-mask-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icon-mask-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
    { "src": "/icon-mono-192.png", "sizes": "192x192", "type": "image/png", "purpose": "monochrome" }
  ]
}
```

The `any` icons are full-bleed. The `maskable` icons have ~20% safe-area
padding so Android/iOS can crop them into any shape. The `monochrome`
icon is for Android's themed-icons feature + iOS Dynamic Island tinting.

**Service worker** (`public/sw.js`, hand-rolled, ~50 lines):

- `install` event: precache app shell (`/leaderboards`, `/_next/static/css/*`
  picked up at build time via a manifest emitted by a small Next.js
  custom build hook, OR — simpler — just precache `/leaderboards` HTML
  and let the runtime cache CSS/JS on first fetch).
- `fetch` event (per resolved review note 7, prescribed HTML detection):
  - `event.request.method !== 'GET'` → bypass to network (no offline
    write queue).
  - URL matches `/api/leaderboards` → SWR: respond from cache if
    present, fetch fresh in background, update cache.
  - `event.request.mode === 'navigate'` (top-level HTML navigation) →
    network-first; on network failure fall back to the precached
    `/leaderboards` shell. This is the **only** HTML branch — using
    `mode === 'navigate'` (not `destination === 'document'`) avoids
    accidentally caching sub-resource HTML and accidentally serving a
    stale `/matches` page to a signed-out user that bypasses
    middleware.
  - URL starts with `/_next/static/` or matches `/icon-*.png` /
    `/manifest.webmanifest` / `/sw.js` → cache-first (static assets
    are fingerprinted, safe to cache aggressively).
  - Everything else (incl. `/api/*` other than leaderboards) →
    network-only.
- `activate` event: clean up old caches by version constant.

**Install hint** (`components/InstallHint*.tsx`):

- `InstallHintAndroid.tsx` — `useEffect` captures `beforeinstallprompt`
  in a ref. On first auth load (detected by reading the session +
  `localStorage["eloup.install.dismissed"] !== "true"`), renders a
  bottom-sheet ("Install EloUp for one-tap access" + Install / Not now).
  Install → call `prompt()` on the captured event. Not now → set
  `localStorage["eloup.install.dismissed"] = "true"`.
- `InstallHintIOS.tsx` — detects iOS Safari via UA regex AND
  `navigator.standalone === false` (iOS-specific flag). Same dismissal
  flag (localStorage). Renders a hint: "Tap the Share button → Add to
  Home Screen" with a small share-icon SVG.

Both components render `null` if the dismiss flag is set or the install
event isn't applicable.

**SW registration** (`lib/pwa/register-sw.ts`, client-side):
```ts
'use client';
import { useEffect } from 'react';
export function RegisterSW() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
```
Rendered in `RootLayout` as `<RegisterSW />`. The Next.js standalone
runtime serves `/sw.js` from `public/` directly.

---

## Symbol updates (commit 5)

Add a new `app` symbol to `symbols/manifest.json`:

```json
"app": {
  "description": "Next.js 15 App Router PWA. shadcn/ui + Tailwind for UI, better-sqlite3 direct (no ORM) for the DB layer, versioned .sql migrations, Auth.js v5 for Discord OAuth (JWT sessions), hand-rolled service worker + manifest for PWA, anonymous-visible leaderboards.",
  "docs": ["docs/app.md"],
  "properties": {
    "ui_lib": "shadcn_ui",
    "css": "tailwind",
    "pwa_strategy": "manual_sw",
    "auth_lib": "authjs_v5",
    "session_strategy": "jwt",
    "db_layer": "better_sqlite3_direct",
    "migration_strategy": "sql_files_versioned",
    "anonymous_leaderboards": true,
    "first_admin_bootstrap": "env_discord_id",
    "test_runner": "vitest",
    "e2e_runner": "playwright"
  },
  "interlocks": {}
}
```

Also extend the `rating` symbol with one new property:

```json
"team_match_formula": "team_average_equal_delta"
```

…which records Q-RATE-2's resolved default. Update `docs/rating.md`'s
"Multi-player matches" section to mention this is committed.

Write `docs/app.md` covering:
- Stack pick rationale (mirroring the table in §"Library picks").
- The route table (mirror of §"Route table").
- The role matrix (mirror of `project-review-and-plan.md` §4.2 table).
- The PWA install strategy.
- ELO transaction lifecycle (forward-reference into `docs/rating.md`).

Run `python3 scripts/align.py lock`. Commit `symbols/manifest.json` +
`symbols/manifest.lock` + `docs/app.md` + `docs/rating.md` together in
commit 5 (UI + symbols).

---

## Dockerfile

Multi-stage, AMD64 only (matches `architecture.image_arch` symbol):

```dockerfile
# syntax=docker/dockerfile:1.6

FROM --platform=linux/amd64 node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM --platform=linux/amd64 node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM --platform=linux/amd64 node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1000 app && useradd -u 1000 -g 1000 -m -d /home/app app
COPY --from=build --chown=1000:1000 /app/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=build --chown=1000:1000 /app/public ./public
COPY --from=build --chown=1000:1000 /app/lib/db/migrations ./lib/db/migrations
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["tini", "--", "node", "server.js"]
```

Key choices:
- `--platform=linux/amd64` on every stage matches the locked symbol;
  no surprise multi-arch.
- `corepack enable` activates pnpm (Node 20 ships corepack).
- `output: 'standalone'` in `next.config.mjs` makes the runtime stage
  tiny: it copies only `.next/standalone/` + `.next/static/` + `public/`,
  no `node_modules/`.
- The migrations directory is copied explicitly because `next build`
  doesn't bundle non-imported assets. `lib/db/migrate.ts` reads files
  at runtime relative to `process.cwd()`.
- UID 1000 matches `K8s/statefulset-web.yaml:60`'s `runAsUser: 1000`
  + `fsGroup: 1000` so `/data` (the PVC mount) is writable.
- `tini` reaps zombies and forwards SIGTERM cleanly so K8s pod
  shutdowns don't leave SQLite WAL files in a dirty state.
- No `HEALTHCHECK` line: K8s does it via the StatefulSet probe.

---

## Out of scope for M4

(repeated from §"Scope" for the reviewer's checklist)

- Tournaments UI/flow (M5)
- Bet UI/flow (M6)
- Heart-rate/Pi (M7)
- Multi-arch images
- Backups (file copy to S3 nightly) — Q-ARCH-2 still open
- Log shipping to Grafana Loki
- Prometheus ServiceMonitor (the existing `K8s/ingress.yaml` has no
  `/metrics` rule and the StatefulSet exposes none)
- Wizard changes (per the M3 hand-off contract)
- DNS changes (M3 phase 8 owns this)

If any of these become blockers, stop and flag, don't bundle.

---

## Verification before reporting done

1. `python3 scripts/align.py check` exits 0 (manifest + lock travel
   together; the new `app` symbol's interlocks empty so no risk of
   broken edges, but verify alignment didn't drift).
2. `cd wizard && python3 -m pytest -q` passes — the existing fleet
   (80-odd tests across M1/M2/M3) is untouched by M4 and must stay
   green. Smoke-checks the "M4 requires zero wizard edits" invariant.
3. `cd eloup-web && pnpm install --frozen-lockfile && pnpm test`
   passes (Vitest unit + integration).
4. `cd eloup-web && pnpm lint && pnpm typecheck` clean.
5. `cd eloup-web && pnpm build` succeeds (catches TS errors that `next
   dev` would mask).
6. `docker build -t eloup-web-m4-test eloup-web/` succeeds. Run with:
   ```bash
   docker run --rm -p 3000:3000 \
     -e DISCORD_CLIENT_ID=x -e DISCORD_CLIENT_SECRET=y \
     -e APP_SESSION_SECRET="$(openssl rand -hex 32)" \
     -e APP_DOMAIN=http://localhost:3000 \
     -e DATABASE_PATH=/data/eloup.sqlite \
     -v "$(mktemp -d)":/data \
     eloup-web-m4-test
   ```
   Confirm:
   - `curl localhost:3000/api/health` → `200 {"ok":true}`.
   - `curl localhost:3000/leaderboards` → 200 HTML (empty leaderboards
     since no players yet, but no crash).
   - `curl localhost:3000/api/auth/signin/discord` → 302 (redirects to
     Discord — won't complete without a real Discord app, but the route
     exists and doesn't 500).
   - `curl localhost:3000/manifest.webmanifest` → 200 JSON.
   - `curl localhost:3000/sw.js` → 200 JS.
7. **Lighthouse mobile on `/leaderboards`** — run via
   `lighthouse http://localhost:3000/leaderboards --preset=desktop --form-factor=mobile`
   (or browser DevTools). Document the score in the doc / commit message
   as a verification artifact. Target ≥ 90 mobile. If unmet, document
   what's pulling it down (likely first-paint JS or non-cached fonts)
   and either fix or flag as a follow-up.
8. **End-to-end live** (against `tow-c1`):
   - Push the M4 branch to GitHub.
   - Re-run the wizard with no flags. Phase 5 rebuilds eloup-web (now
     picks up the `eloup-web/` directory). Phase 6 re-renders with the
     new SHA. Phases 7→9 push + sync. ArgoCD goes to Healthy.
   - `curl https://eloup.kodloki.io/api/health` → 200.
   - Open `https://eloup.kodloki.io` on mobile Safari.
   - Complete a real Discord OAuth sign-in (requires a real Discord
     application + my snowflake set via `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID`).
   - Log a 2-player match with a second account, have the second
     account confirm, observe the ELO change on `/leaderboards`.
   - **If full E2E is blocked** (no real Discord app, no second test
     account at hand): report what was verified locally + what
     specifically wasn't smoke-tested. Steps 1–7 are non-negotiable;
     step 8 is best-effort.

---

## Commit shape

Five commits expected (mirroring M2/M3 plus one wizard fix commit
inserted between engine and UI per resolved review note 5):

1. **`docs: M4 — eloup-web MVP task doc + extend review gate to eloup-web/`**
   — already landed as `d868c6d`.
   - `Agents/TODO/Active/m4-eloup-web-mvp.md`
   - `.claude/hooks/require-review.sh` (one-line case-extension)
   - `CLAUDE.md` (adds `eloup-web/` to gated-paths sentence)

2. **`docs: M4 — reviewer report for eloup-web MVP`** — already landed
   as `91805e9` (different `## Reviewer:`).
   - `Agents/Review-reports/m4-eloup-web-mvp-review.md`

   *(A "fold review findings" commit may land between 2 and 3 mirroring
   M3's `cfab19c`, depending on the size of the edits to this task
   doc.)*

3. **`feat: eloup-web — auth + schema + ELO engine`** (Phases A–D)
   - `eloup-web/` scaffold: `Dockerfile`, `package.json`, `pnpm-lock.yaml`,
     `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `.eslintrc.cjs`,
     `.prettierrc`, `.dockerignore`, `vitest.config.ts`
   - `lib/env.ts`, `lib/auth.ts`, `lib/permissions.ts`, `lib/elo.ts`,
     `lib/db/{client,migrate,queries,match}.ts`,
     `lib/db/migrations/0001_init.sql`
   - `app/api/health/route.ts`, `app/api/auth/[...nextauth]/route.ts`
   - Minimal `app/layout.tsx` + `app/page.tsx` (redirect) so `next build`
     succeeds
   - All Vitest unit + integration tests
   - **Approximately 1,200–1,500 lines.** **Does NOT touch `symbols/`
     — alignment stays valid throughout** (per resolved review note 6).

4. **`fix: wizard ingress — add proxy-buffer-size for OAuth callbacks`**
   - `wizard/wizard/phases/_manifests.py` — adds
     `nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"` to the
     ingress template
   - `wizard/tests/test_generate_manifests.py` — updated/new assertion
     that the rendered ingress includes the new annotation
   - **One annotation + one test update**, ~15 lines diff. Why
     separate: keeps wizard touches bisectable apart from app code per
     M3's discipline ("M4 requires zero wizard edits" was aspirational;
     the OAuth buffer is the one exception, recorded as such in the
     M4→M5 hand-off contract).

5. **`feat: eloup-web — routes, UI, PWA, symbol updates`** (Phases E–G)
   - shadcn/ui scaffold + copied components (`components/ui/*`)
   - Domain components (`BottomNav`, `InstallHint*`, `PlacementInput`,
     `ParticipantPicker`, `ConfirmRowButton`)
   - All five `app/*` pages + remaining `app/api/*` routes (including
     `app/api/matches/[id]/confirm/route.ts` per resolved review note 1)
   - PWA assets (`public/manifest.webmanifest`, `public/sw.js`,
     `public/icon-*.png` — separate any + maskable entries)
   - Symbol + docs: `symbols/manifest.json` (new `app` symbol +
     `rating.team_match_formula`), `symbols/manifest.lock` (regenerated),
     `docs/app.md` (new), `docs/rating.md` (minor edit)
   - Playwright E2E spec
   - **Approximately 1,200–1,500 lines.** Symbol changes land here so
     `align.py check` only needs to be run once at the end.

Splitting 3+5 keeps each diff under ~1.5k lines (M3 reviewer's
comfortable upper bound) and lets a future revert pull the UI without
unwinding the engine. Commit 4 is intentionally tiny.

Each commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context)
<noreply@anthropic.com>`.

---

## M4→M5 hand-off contract

After M4 ships, M5 (tournaments) inherits:

- **`players.role` already permits `'tournament_admin'`** via the CHECK
  constraint in `0001_init.sql`. M5 adds the promotion UI/API + the
  permission rules.
- **`tournaments`, `tournament_admins`, `tournament_members` tables
  exist** (schema only, no rows ever written by M4). M5 adds the CRUD
  + invite-token issuance flow.
- **`matches.tournament_id` is nullable and unused.** M5 starts
  populating it for tournament matches.
- **BottomNav has a reserved fourth slot** for `/tournaments`. M4
  renders it disabled with a "Coming soon" tooltip (matching the brief's
  preferred option — hiding it entirely would mean a BottomNav layout
  shift when M5 ships). M5 swaps the disabled icon for a live route.
- **ELO transaction in `lib/db/match.ts` is pool-agnostic.** Per
  Q-TOURN-2 (still TBD), if tournaments use a separate rating pool,
  M5 adds `tournament_ratings(player_id, tournament_id, current_rating)`
  + a branch in the confirm-match path keyed on `match.tournament_id`.
  Today the confirm code reads from `ratings` regardless of
  `tournament_id`; the change is additive.
- **One new optional env var introduced by M4** —
  `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID`. It is NOT wired through the
  wizard (no configmap entry, not in `APP_RUNTIME_SECRET_KEYS`). The
  operator supplies it post-deploy via `kubectl set env
  statefulset/eloup-web -n eloup
  ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID=<snowflake>`. `lib/env.ts` declares
  it `z.string().optional()` so the container starts cleanly when it's
  absent (resolved review note 2). If M5/M6 want to elevate this to a
  wizard-provisioned value, the configmap renderer in
  `wizard/wizard/phases/_manifests.py` is the touch point.
- **No other new env vars needed by M4.** If M5 needs one (e.g.
  `ELOUP_TOURNAMENT_DEFAULT_K`), that secret must be threaded into
  `wizard/wizard/phases/generate_manifests.py`'s configmap renderer
  (non-secrets) or `APP_RUNTIME_SECRET_KEYS` (secrets).

## M4→M6 hand-off contract

After M4 ships, M6 (hidden betting) inherits:

- **`bets` table exists** with the columns from
  `project-review-and-plan.md` §4.2. M6 starts writing rows; no
  migration needed.
- **`overall_ratings.escrowed_elo` column exists** with the
  `CHECK(current_rating >= 0)` constraint per Q-BET-2. M6's placement
  flow debits `current_rating` and credits `escrowed_elo` in one
  transaction.
- **The confirm-match transaction in `lib/db/match.ts` is the
  settlement point.** M6 adds a `settleBets(matchId, tx)` call inside
  the existing `BEGIN IMMEDIATE` so settlement is atomic with the ELO
  update.
- **Cap rule** (Q-BET-3, decided): `max(|per-game rating_delta|)` over
  participants. M6's placement endpoint computes this prospectively
  using each participant's current `ratings.current_rating` and the
  game's K-factor.
- **Reveal mechanism** (Q-BET-1, default touch gesture): M6's UI is
  hidden until the gesture. No M4 code currently emits any
  betting-related DOM.
- **The `betting` symbol stays at `reveal_mechanism: "TBD"`** until M6.
  M4 doesn't move it.

---

## Open follow-ups (NOT blocking M4 — flag for the user)

These came up while planning M4 and don't fit in M4 scope:

1. **Backups (Q-ARCH-2).** SQLite DB file is the source of truth.
   Nightly file-copy to an S3-compatible bucket (Backblaze B2, S3, or
   the Linode Object Storage that's already provisioned in the
   account?) is the cheapest insurance policy. Owner: user — pick a
   bucket + provide creds → I can add a `cronjob-backup.yaml` to `K8s/`
   in a follow-up task. Not M4.
2. **Log shipping.** Grafana is already on the cluster
   (`grafana.kodloki.io` per cluster_conventions.md). Next.js logs to
   stdout, K8s captures them — but they live and die with the pod.
   Loki + Promtail would persist them. Not M4.
3. **Metrics.** `/api/health` is binary up/down. A `/metrics`
   endpoint emitting `next_request_duration_seconds`,
   `db_query_duration_seconds`, `players_total` would give Grafana
   something to graph. Not M4.
4. **CSP + security headers.** Defaults from Next.js are OK; a
   custom `headers()` in `next.config.mjs` adding `Strict-Transport-Security`,
   `Content-Security-Policy`, `X-Frame-Options: DENY`, `Referrer-Policy:
   strict-origin-when-cross-origin` is a one-line follow-up.
5. **Rate limiting on `/api/matches` POST.** A single bad actor could
   spam pending matches. Server-side cooldown
   (one match per player per minute) is sufficient for party scale.
   Not M4.
6. **The placeholder image (`grafana/grafana:latest`) currently
   deployed.** Once M4 lands and the wizard re-runs, this flips to the
   real image. After that, the `--web-image` smoke-test mode can stay
   as-is for future placeholder needs.

---

## Resolved review notes

The independent review at `Agents/Review-reports/m4-eloup-web-mvp-review.md`
produced the following changes to this plan. Each item names the
review finding it addresses and the section above that was amended.

1. **[MAJOR #1] File-tree / route-table mismatch: `/api/matches/[id]/confirm`
   had no corresponding file.** The file tree now lists
   `app/api/matches/[id]/confirm/route.ts` as a separate entry from
   `app/api/matches/route.ts` (POST → create). The commit-5 file list
   in §"Commit shape" mentions the confirm route explicitly. The route
   table was already correct; the gap was in the file tree + commit
   list. Without this, the confirm endpoint would have 404'd at
   runtime.

2. **[MAJOR #2] `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` must be optional
   in `env.ts`.** The `lib/env.ts` description in §"File tree" now
   splits the zod schema into required (5 keys) and optional (1 key:
   `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` as `z.string().optional()`).
   Q-AUTH-3's row in §"Confirmed open questions" now documents the
   operator-supply mechanism (`kubectl -n eloup set env
   statefulset/eloup-web …`) since the wizard's configmap renderer
   does not emit this key. The M4→M5 hand-off contract was amended:
   "No new env vars" → "One optional env var, supplied post-deploy
   by the operator." Without this fix, the container would crash on
   startup of every deployment where the operator hasn't set the var.

3. **[MAJOR #3] `overall_ratings` upsert must preserve `escrowed_elo`.**
   Flow 4 step 6's transaction spec now includes the explicit SQL
   form of the upsert. `escrowed_elo` is omitted from both the
   INSERT tuple (DEFAULT 0 fires) and the `ON CONFLICT DO UPDATE SET`
   clause (column stays untouched on conflict). A new
   `confirm-match.test.ts` case seeds a non-zero `escrowed_elo` before
   confirming and asserts the value is preserved post-confirm. M6's
   bet placement writes this column; M4's confirm transaction must not
   silently overwrite it.

4. **[MAJOR #4] DDL nullability on `match_participants.rating_before`
   / `rating_delta`.** Added a §"DDL nullability" subsection under
   §"DB migration strategy" naming every nullable column in
   `0001_init.sql` explicitly. `rating_before REAL NULL` and
   `rating_delta REAL NULL` are nullable because Flow 3 inserts the
   row with both as NULL and Flow 4's confirm transaction fills them.
   The umbrella plan's §4.2 sketch was ambiguous; this clarifies.

5. **[MINOR #5] `proxy-buffer-size` annotation absent from ingress —
   Next.js + Auth.js v5 OAuth 502 risk.** Added a new commit 4 to
   §"Commit shape" that touches the wizard's ingress template in
   `wizard/wizard/phases/_manifests.py` to include
   `nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"`. This is the
   one wizard touch in M4, justified explicitly in §"Scope" and the
   M4→M5 hand-off contract. Without it, the first OAuth callback would
   502 on default nginx buffers — production-breaking for an
   OAuth-dependent app.

6. **[MINOR #6] Alignment validity between commits 3 and 5.** The
   reviewer flagged that the new `app` symbol (with `docs:
   ["docs/app.md"]`) is written to `manifest.json` in commit 5, but
   `docs/app.md` is also written in commit 5 — so they travel together
   and alignment stays valid. The §"Commit shape" entry for commit 3
   now explicitly says "Does NOT touch `symbols/` — alignment stays
   valid throughout." Commit 4 also doesn't touch `symbols/`. Commit 5
   does both at once, then runs `align.py lock`. No interim window
   where alignment is broken.

7. **[MINOR #7] SW HTML detection ambiguity.** §"PWA install
   strategy"'s service-worker section now prescribes
   `event.request.mode === 'navigate'` (not `destination === 'document'`)
   for the HTML network-first branch. This avoids accidentally caching
   sub-resource HTML and serving a stale `/matches` shell to a
   signed-out user (which would bypass middleware). The non-`navigate`
   `/api/*` and static-asset branches are explicit.

8. **[MINOR #8] `purpose: "any maskable"` is non-standard.** The
   `manifest.webmanifest` example in §"PWA install strategy" now lists
   separate icon entries for `"purpose": "any"` (full-bleed) and
   `"purpose": "maskable"` (with safe-area padding). Public assets
   renamed `/icon-any-{192,512}.png` and `/icon-mask-{192,512}.png`.
   The monochrome icon stays as one entry. This restores Lighthouse's
   PWA-install audit pass.

9. **[NIT #9] Per-game ratings floor policy comment.** §"ELO function
   signatures" now requires a single-line comment in `lib/db/match.ts`
   above the per-game upsert: `// per-game ratings are intentionally
   NOT floored at 0 — only overall_ratings is …`. Prevents a future
   M5/M6 implementer from "fixing" the missing clamp.

10. **[NIT #10] `install-hint/page.tsx` removal criterion.** The
    debug route was dropped from the file tree entirely. The
    install-hint components render inside `RootLayout` and are
    tested via Vitest + Playwright; the dedicated debug route added
    no value. The §"File tree" rationale now records the deletion.

11. **[NIT #11] Commit 1 size deviation.** Acknowledged in §"Workflow
    gate" and §"Commit shape". No action required — the hook edit was
    pre-approved by the user as a one-line safety improvement.

### Open questions the reviewer did not raise

- **`tournament_admin` enforcement scope.** The Q-AUTH-2 default of
  "all participants confirm" sidelines `tournament_admin`'s edit
  power in M4 — global_admin can edit any match, but
  `tournament_admin` has no edit path until M5 ships the tournament
  match flow. The permission matrix in §4.2 is honored as-described.
- **Lighthouse score automation.** §"Verification before reporting
  done" treats the ≥ 90 mobile target as a manual measurement to
  document in the commit message. A CI Lighthouse job is a useful
  follow-up but not M4 scope.
