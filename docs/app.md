# App

The EloUp web app — code lives in `eloup-web/`. Mobile-first PWA backed by SQLite, behind Discord OAuth.

## Stack picks

| Pick                                | Why                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js 15 (App Router)             | Single deployable surface; server actions + route handlers + RSC let server-rendered pages read SQLite directly without an extra service layer.                                                                    |
| TypeScript strict                   | Catches schema↔code drift early. `noUncheckedIndexedAccess` is on so map lookups must be checked.                                                                                                                  |
| Auth.js v5 + Discord provider       | Built-in Discord support, JWT sessions (no DB sessions table needed). Scopes `identify email`. `trustHost: true` for self-hosted ingress.                                                                          |
| `better-sqlite3` direct (no ORM)    | Single-replica SQLite + ~12 distinct queries — an ORM adds dep + codegen with no real safety win. Schema is one SQL file the reviewer reads end-to-end.                                                            |
| Versioned `.sql` files in `lib/db/migrations/` | One file per migration; migrator (`lib/db/migrate.ts`) skips already-applied versions inside `BEGIN IMMEDIATE`. M4 ships `0001_init.sql` only.                                                          |
| Tailwind + hand-written components  | Originally planned shadcn/ui; settled on hand-written Tailwind components since the M4 UI is small (~6 components) and shadcn's value (copy-paste primitives) is overkill for the count.                          |
| Hand-rolled service worker + manifest | `next-pwa` lags App Router; `@serwist/next` is a third-party fork. Our SW is ~50 lines covering app-shell precache + leaderboard SWR + navigation network-first.                                                 |
| `zod` for env-var validation        | Throws at module import if required env is missing/invalid. `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` is `.optional()` because the wizard never provisions it.                                                            |
| Vitest                              | Native ESM, no `ts-jest` dance. Unit + integration tests, integration uses real ephemeral SQLite (no DB mocks).                                                                                                    |
| Playwright (optional E2E)           | One smoke spec for the public surface — full sign-in E2E requires a real Discord app, deferred.                                                                                                                    |

## Route table

| Route                          | Method   | Auth                  | Description                                                                                              |
| ------------------------------ | -------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `/`                            | GET      | anonymous             | 307 redirect → `/leaderboards`                                                                           |
| `/leaderboards`                | GET      | **anonymous**         | Tabs: Overall + each game; top-N by `current_rating DESC`                                                |
| `/matches`                     | GET      | user                  | Pending + recent for signed-in player                                                                    |
| `/matches/new`                 | GET      | user                  | Game-picker → participants → placements → submit                                                         |
| `/matches/[id]`                | GET      | user                  | Participant grid + confirm-my-row CTA                                                                    |
| `/profile`                     | GET      | user                  | Overall + per-game ratings + recent matches                                                              |
| `/games`                       | GET      | **global_admin**      | Catalog + add-game form                                                                                  |
| `/api/health`                  | GET      | anonymous             | `SELECT 1` → 200 `{ok:true}` or 503; K8s probe target                                                    |
| `/api/auth/*`                  | various  | Auth.js               | OAuth handlers                                                                                           |
| `/api/leaderboards`            | GET      | anonymous             | JSON; SW caches with SWR                                                                                 |
| `/api/matches`                 | POST     | user                  | Create match (`status=pending`, creator's own row auto-confirmed)                                        |
| `/api/matches/[id]/confirm`    | POST     | user (own row)        | Flip caller's row to confirmed; if last → run ELO transaction                                            |
| `/api/games`                   | GET      | anonymous             | Catalog list (consumed by `/matches/new`)                                                                |
| `/api/games`                   | POST     | global_admin          | Add a game                                                                                               |

Middleware (`middleware.ts`) gates `/matches/*`, `/profile/*`, `/games/*`, and mutating `/api/matches/*` + `/api/games`. The real role check for `global_admin`-only routes lives in the handler — middleware just confirms a session cookie exists.

## Role matrix

| Action                              | Anonymous | user | tournament_admin | global_admin |
| ----------------------------------- | --------- | ---- | ---------------- | ------------ |
| View leaderboards                   | ✓         | ✓    | ✓                | ✓            |
| Enter a match                       | —         | ✓    | ✓                | ✓            |
| Confirm own row                     | —         | ✓    | ✓                | ✓            |
| Edit any match in their tournament  | —         | —    | (M5)             | ✓            |
| Edit any match anywhere             | —         | —    | —                | ✓            |
| Add/edit games                      | —         | —    | —                | ✓            |
| Place bets (M6, when revealed)      | —         | ✓    | ✓                | ✓            |

`tournament_admin` role exists in the `players.role` CHECK constraint as of M4 — the issuance flow + tournament match-edit permission both land in M5.

## Admin bootstrap

`ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` is an **optional** env var. The wizard does not provision it — the operator sets it on the running StatefulSet after first deploy:

```bash
kubectl -n eloup set env statefulset/eloup-web ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID=<your-discord-snowflake>
```

The pod restarts, and the next sign-in matching that snowflake promotes the player's `role` to `global_admin` inside the `signIn` callback's transaction. The promotion is idempotent — re-running with the same env var on an existing `global_admin` is a no-op. Once promoted, the env var can be removed (the row in `players` is the authoritative state).

## PWA install strategy

- `public/manifest.webmanifest` — `display: standalone`, `start_url: /leaderboards`, separate icon entries for `purpose: any` and `purpose: maskable` (W3C-correct — Lighthouse penalizes `"any maskable"`).
- `public/sw.js` — hand-rolled, ~50 lines:
  - **Navigations** (`request.mode === 'navigate'`): network-first, fall back to precached `/leaderboards` shell when offline.
  - **`GET /api/leaderboards`**: stale-while-revalidate so the cached page renders instantly while a fresh fetch updates.
  - **Static assets** (`/_next/static/*`, `/icon-*`, `/manifest.webmanifest`): cache-first (fingerprinted).
  - **Everything else** (POST, `/api/*` other than leaderboards): bypass to network — no offline write queue.
- `components/InstallHintAndroid.tsx` — captures `beforeinstallprompt`, shows a one-time install banner.
- `components/InstallHintIOS.tsx` — UA-detects iOS Safari + `navigator.standalone === false`, shows "Tap Share → Add to Home Screen". Dismissal in `localStorage["eloup.install.dismissed"]`.

## ELO transaction lifecycle

When a `match_participants.confirmed_at` flip leaves no unconfirmed rows, `lib/db/match.ts:confirmRow` runs the per-game + overall ELO update inside the same `BEGIN IMMEDIATE` transaction that flipped the row. See `docs/rating.md` for the algorithm.

The `overall_ratings.escrowed_elo` column is reserved for M6 (betting). M4's transaction MUST NOT overwrite it — the upsert omits the column from both the INSERT tuple and the `ON CONFLICT DO UPDATE SET` clause so it stays untouched on conflict. A regression test covers this in `tests/integration/confirm-match.test.ts`.

## Env vars consumed at runtime

| Name                                 | Required | Source                                 |
| ------------------------------------ | -------- | -------------------------------------- |
| `DISCORD_CLIENT_ID`                  | yes      | ConfigMap (wizard phase 6)             |
| `APP_DOMAIN`                         | yes      | ConfigMap (wizard phase 6)             |
| `DATABASE_PATH`                      | yes      | ConfigMap (wizard phase 6)             |
| `DISCORD_CLIENT_SECRET`              | yes      | SealedSecret (wizard phase 6)          |
| `APP_SESSION_SECRET`                 | yes      | SealedSecret (wizard phase 6)          |
| `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID`   | no       | Operator via `kubectl set env`         |

Adding a new runtime secret in M5/M6 requires updating `wizard/wizard/phases/_manifests.py:APP_RUNTIME_SECRET_KEYS` and the wizard's collect-secrets prompt. Non-secret env vars need to be added to the configmap renderer.
