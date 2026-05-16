# M4 — eloup-web MVP — Review report

## Reviewer: claude-sonnet-4-6-m4-reviewer
## Task: m4-eloup-web-mvp.md
## Date: 2026-05-15

> **Verdict: APPROVE WITH CHANGES.** The M4 plan authored by `claude-opus-4.7-m4-implementer` is
> the most complete per-milestone task doc yet: the ELO pure-function design is genuinely clean,
> the atomic confirm-match transaction is correctly specified (BEGIN IMMEDIATE + re-SELECT guard),
> and the M3→M4 contract fidelity on port/probe/UID is verified against the actual wizard code.
> The weakest areas are (1) a route definition mismatch between the file tree and the route table
> that will produce a 404 at runtime, (2) a missing env-var optionality declaration for
> `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` in `env.ts` that will break the wizard's container on
> startup, and (3) two schema gaps relative to §4.2. None are architectural blockers but all three
> must be folded into the plan before commits 3+4 begin.

---

## Findings

### [MAJOR]

**1. File-tree / route-table mismatch: `/api/matches/[id]/confirm` has no corresponding file**

The route table (§"Route table") declares:
```
POST /api/matches/[id]/confirm  user (must own row)  flip the caller's row...
```
The `ConfirmRowButton.tsx` component also references this path via a server action.

The file tree, however, lists only:
```
app/api/matches/route.ts   POST (create); PATCH (confirm row)
```
There is no `app/api/matches/[id]/confirm/route.ts` in the file tree. The route table and the
Flow 4 walkthrough both say the endpoint is `POST /api/matches/[id]/confirm` with the match id in
the URL path (so the handler can access `params.id`). A flat `matches/route.ts` cannot serve
`/api/matches/[id]/confirm` — Next.js App Router would 404. Either the file tree is wrong (needs
`app/api/matches/[id]/confirm/route.ts`) or the route table is wrong (PATCH on `/api/matches` with
the id in the body). These must be reconciled before commit 3. The commit-3 file list in
§"Commit shape" also omits this route file, so the mismatch extends across three sections.

---

**2. `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` in `env.ts` zod schema must be optional**

`lib/env.ts` is described as: "zod schema for `DISCORD_CLIENT_ID/SECRET`, `APP_SESSION_SECRET`,
`APP_DOMAIN`, `DATABASE_PATH`, `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID`; throws at module import if
invalid."

`ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` is NOT provisioned by the wizard. The wizard's configmap
renders three keys (`DISCORD_CLIENT_ID`, `APP_DOMAIN`, `DATABASE_PATH`) and the SealedSecret
renders two (`DISCORD_CLIENT_SECRET`, `APP_SESSION_SECRET`). `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID`
is an operator-supplied value that has no wizard UI, is not part of `APP_RUNTIME_SECRET_KEYS`, and
is not in the configmap renderer in `_manifests.py`. If `env.ts` declares it as a required zod
field (`z.string()`), the container will crash on startup whenever the operator has not set it
(i.e., for any deployment after the initial admin bootstrap). It must be declared optional:
`z.string().optional()` (or equivalently `.default("")`). The plan also says "No new env vars
needed by M4" in the M4→M5 hand-off contract — but `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` is a new
env var introduced by M4 and never wired through the wizard. This is acceptable (operator sets it
manually in the cluster or the wizard is re-run once with extra config), but the plan needs to
document how the operator supplies it (e.g., manual `kubectl set env` on the StatefulSet, or a
one-time wizard flag). Without this the admin bootstrap is undeployable as described.

---

**3. Schema coverage gap: `overall_ratings` is missing `escrowed_elo` in the ELO transaction spec**

§4.2 of the umbrella plan (`project-review-and-plan.md`) is explicit:
> Extend `overall_ratings` with `escrowed_elo NUMERIC NOT NULL DEFAULT 0` and a CHECK constraint
> `current_rating >= 0`.

The M4 plan's §"M4→M6 hand-off contract" correctly states "`overall_ratings.escrowed_elo` column
exists." `docs/architecture.md` also lists `escrowed_elo` in the data model sketch. However, the
ELO transaction walkthrough in Flow 4 step 6 says:
```
INSERT OR UPDATE overall_ratings: `current_rating = max(0, current_rating + d_overall)`, `last_match_id = ?`.
```
There is no mention of `escrowed_elo` in this INSERT-OR-UPDATE. If the INSERT uses `INSERT OR
REPLACE` (or `ON CONFLICT DO UPDATE`) and omits `escrowed_elo`, SQLite will set it to the DEFAULT
(0) on a first-insert — which is correct. But on UPDATE via the upsert path, the column must be
explicitly preserved (not re-set to DEFAULT), otherwise a player who placed a bet before their
first match would lose their escrow when the first overall_ratings row is written. The upsert
must name `escrowed_elo` explicitly and either keep it unchanged (most likely intent: `escrowed_elo
= excluded.escrowed_elo`) or set it (wrong). The plan does not make this explicit — the
implementer will write this upsert without a spec anchor. Add a line to Flow 4's transaction spec
that explicitly says the upsert preserves `escrowed_elo`.

---

**4. Schema coverage gap: `match_participants` missing `rating_before` NULL handling at first match**

Flow 4 step 6 includes:
```
SELECT all rows for this match with their `ratings.current_rating`
(LEFT JOIN — null if no row yet → use 1200 default).
```
This is correct. However, the schema description at §4.2 says:
```
match_participants(match_id, player_id, team_label NULL, placement INT NULL,
                   score NUMERIC NULL, rating_before, rating_delta, confirmed_at NULL)
```
`rating_before` in the schema has no NULL annotation, implying NOT NULL. But Flow 4 step 3 says
"INSERT INTO match_participants with `confirmed_at = NULL`, `rating_before = NULL`" — the row is
inserted with `rating_before = NULL` and only filled at confirm time (Flow 4 step 6: "UPDATE
match_participants SET rating_before = X, rating_delta = D"). If `rating_before` is NOT NULL in
the DDL, this INSERT will fail. The `0001_init.sql` must declare `rating_before NUMERIC NULL` and
`rating_delta NUMERIC NULL` to match the described flow. The plan's verbal description of Flow 3
confirms this intent but the schema sketch from §4.2 (which the doc says `0001_init.sql` covers
"exactly") is ambiguous. Clarify in the plan that `rating_before` and `rating_delta` are nullable
in the DDL.

---

### [MINOR]

**5. `proxy-buffer-size` annotation absent from ingress — known Next.js OAuth 502 cause**

The M3 reviewer (m3-wizard-phases-6-9-review.md, §2) flagged that shine's ingress annotation block
does not include `nginx.ingress.kubernetes.io/proxy-buffer-size`. This was left as a [NIT] for M3
because phase 6 was copying shine verbatim. For M4, the concern is acute: Next.js App Router with
Auth.js v5's JWT sessions sends large `Set-Cookie` headers on the OAuth callback, and Discord's
OAuth response includes a large state token. Without `proxy-buffer-size: "16k"` (or similar),
nginx will 502 on the first OAuth callback under default buffer settings. The current ingress
template in `_manifests.py` (confirmed by reading the file) does not include this annotation. M4
should add it to the ingress template in the wizard, or document clearly that the operator must
add it manually after deployment. Adding it to the wizard is the safer path.

---

**6. `app` symbol lists `docs: ["docs/app.md"]` but `app.md` does not exist at time of commit 3**

The new `app` symbol is written to `symbols/manifest.json` in commit 4. `docs/app.md` is also
written in commit 4. This means `python3 scripts/align.py check` will fail between the start of
commit 3 and the end of commit 4: commit 3 may update `manifest.json` (per commit shape, actually
it does not — but if alignment is run between commits 3 and 4 for any reason, the interlock check
will see a missing doc). This is a minor sequencing concern: alignment must not be run until
commit 4 completes. The plan says "Run `python3 scripts/align.py lock`" at commit 4 — just be
explicit that alignment will be broken in the interim and no one should run `align.py check` after
commit 3 and before commit 4 lands.

---

**7. SW cache strategy: HTML network-first is stated but the "Other GET requests" branch is ambiguous**

The service worker's `fetch` handler specifies:
> "Other GET requests → cache-first for same-origin static assets; network-first for HTML."

The ambiguity is in "HTML" detection. Next.js serves HTML from the App Router with
`Content-Type: text/html`, but the `fetch` event sees the request URL, not the response headers.
Detecting HTML by URL (e.g., requests that do not match `/_next/static/*` or `/api/*`) is the
correct implementation pattern. If the implementer uses `event.request.destination === 'document'`
for HTML detection, this works for top-level navigations but misses same-origin sub-resource
fetches. The plan is hand-wavy here — for a ~50-line SW, the doc should be explicit about the
detection strategy. The failure mode if `/matches` is accidentally cached is: a stale offline
response served to an unauthenticated user, bypassing middleware and exposing the page shell (no
data, but a confusing blank render). Prescribe `event.request.mode === 'navigate'` for the HTML
network-first branch.

---

**8. `purpose: "any maskable"` in `manifest.webmanifest` is deprecated**

The planned manifest specifies:
```json
{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" }
```
The W3C Web App Manifest spec and Chrome's Lighthouse (as of late 2024) flag `"any maskable"` as
incorrect — `purpose` should be a single keyword or two separate icon entries. Correct form is
either `"purpose": "maskable"` (icon is designed to be masked — crop-safe) or `"purpose": "any"`
(full-bleed icon, no masking expected). For a maskable icon, use `"maskable"` only. For a
full-bleed icon that also works as a general icon, list two entries: one `"purpose": "any"` and
one `"purpose": "maskable"`. Combining them in one string is non-standard and Lighthouse penalizes
it. This directly threatens the Lighthouse ≥ 90 mobile target.

---

### [NIT]

**9. `per-game ratings` floor policy stated ambiguously**

The plan says: "Per-game ratings have no floor — they can dip below 0 in theory." The schema
section and the §4.2 umbrella spec only prescribe a CHECK constraint on `overall_ratings.current_
rating >= 0`. The plan's ambiguity is fine for M4, but `lib/elo.ts`'s pure function returns raw
deltas, and the apply layer in `lib/db/match.ts` only clamps `overall_ratings` (stated explicitly
in Flow 4). A comment in `lib/db/match.ts` should make explicit that per-game `ratings.current_
rating` is intentionally unclamped, so a future M5/M6 implementer doesn't add a clamp there
thinking they're fixing a bug.

---

**10. `install-hint/page.tsx` "maybe drop" file should have an explicit removal criterion**

The file tree lists `app/install-hint/page.tsx` with the note "Drop pre-merge if unused." This
is fine as a local debugging aid, but the plan does not define what "unused" means — is it unused
if no Playwright test covers it, or if no human opened it during review? Add a concrete criterion:
"Drop this file if the Playwright E2E spec does not reference `/install-hint`." This prevents the
dead route from silently shipping.

---

**11. Commit 1 bundles three files; prior milestones bundled one**

The plan acknowledges this deviation from the M2/M3 "task doc only" commit-1 pattern and explains
the rationale. The hook extension and CLAUDE.md edit are genuinely low-risk, and the user
pre-approved the approach. This NIT stands only as a note for future reviewers: commit 1 of M4
is larger than prior milestones' commit 1s, and the hook edit is worth a deliberate glance to
confirm the case-statement syntax is correct before proceeding to commits 3+4.

---

## Things the plan got right

- **ELO function purity.** `lib/elo.ts` taking no I/O and `lib/db/match.ts` owning the apply
  layer (including floor clamping) is a clean design. The floor-belongs-at-apply-layer rationale
  is correct: a raw delta of −500 against a current rating of 100 should clamp to 100, not −400,
  which requires knowing the current rating — hence the apply layer, not the pure function.

- **Atomic confirm-match transaction.** The race-condition guard (BEGIN IMMEDIATE + re-SELECT
  `confirmed_at` after locking, return 200 on non-null for idempotency) is correctly specified and
  matches the "double-tap is fine" UX requirement. Step 5's COUNT check for remaining unconfirmed
  rows before running the ELO update is correct.

- **M3→M4 contract fidelity verified.** Port 3000, `/api/health` returning `{ok:true}`, UID
  1000 / fsGroup 1000 (verified against `K8s/statefulset-web.yaml` and `_manifests.py` rendered
  output), PVC at `/data` (verified `DATABASE_PATH = /data/eloup.sqlite` in `_manifests.py`),
  `envFrom` from configmap + sealed secret (verified), and the five env vars
  (`DISCORD_CLIENT_ID`, `APP_DOMAIN`, `DATABASE_PATH`, `DISCORD_CLIENT_SECRET`,
  `APP_SESSION_SECRET`) match the three configmap keys + two sealed-secret keys exactly.
  `_resolve_eloup_web_spec()` in `build_images.py` correctly checks `workspace/eloup-web/` first,
  then `Dockerfile.eloup-web` at root — the plan's description is accurate.

- **`APP_RUNTIME_SECRET_KEYS` verification.** Confirmed in `_manifests.py` line 40:
  `frozenset({"discord_client_secret", "app_session_secret"})` — exactly two keys, no drift.
  `render_plain_secret()` defensively validates the input against this set and raises if unexpected
  keys are passed. The plan correctly describes both behaviors.

- **Migration idempotency.** BEGIN IMMEDIATE for each migration file (correct lock level for
  single-writer SQLite), `schema_migrations` table for version tracking, and the
  "module-level applied flag" guard against concurrent module imports are all reasonable. For a
  single-replica StatefulSet the guard is belt-and-suspenders but harmless.

- **Auth.js v5 + JWT session DB write placement.** The `signIn` callback is the correct place for
  the `players` upsert in Auth.js v5 (the `jwt` callback fires after, with `account` non-null on
  first login — this is the right sequence). The concurrent-same-user sign-in scenario is handled
  by the BEGIN IMMEDIATE transaction.

- **Out-of-scope discipline.** The plan correctly defers tournaments UI/flow, betting UI/flow,
  heart-rate, and the projection view. The `bets` table and `overall_ratings.escrowed_elo` column
  ship in `0001_init.sql` for M6 continuity without exposing M6 behavior in M4 — correct. The
  `betting.reveal_mechanism` symbol property stays TBD — correct.

- **Test plan boundary.** Real ephemeral SQLite for integration tests, OAuth network mocked — this
  is correct. No integration test mocks the DB (the plan explicitly says "real ephemeral SQLite"
  and lists no DB mocks). The `confirm-match.test.ts` test calls the handler function directly
  with a mocked session, not a real HTTP request — acceptable for integration testing in Next.js.

- **PWA install hint design.** The UA-keyed dismiss-flag approach (`localStorage["eloup.install.
  dismissed"]`) correctly handles the case where dismissing on iOS should not suppress on Android.
  Both `beforeinstallprompt` capture for Android and the `navigator.standalone` check for iOS are
  the right detection mechanisms. `display: standalone` + `start_url: /leaderboards` is correct.

---

## Verification I performed

1. Read `Agents/TODO/Active/m4-eloup-web-mvp.md` in full.
2. Read `Agents/TODO/Active/m3-wizard-phases-6-9.md` §"M3→M4 hand-off contract" and cross-checked
   every contract item against the M4 plan's Dockerfile spec, route table, and Flow 4 walkthrough.
3. Read `Agents/TODO/Active/project-review-and-plan.md` §4.2 and compared every table in scope
   (players, games, matches, match_participants, ratings, overall_ratings, tournaments,
   tournament_admins, tournament_members, bets) against the plan's coverage claims.
4. Read `Agents/Review-reports/m3-wizard-phases-6-9-review.md` for format and severity-level
   conventions.
5. Read `symbols/manifest.json` and `docs/auth.md`, `docs/rating.md`, `docs/architecture.md`,
   `docs/betting.md` for locked decisions.
6. Read `wizard/wizard/phases/build_images.py` — confirmed `_resolve_eloup_web_spec()` checks
   `workspace/eloup-web/` (dir) then `Dockerfile.eloup-web` (file) exactly as the plan states.
7. Read `wizard/wizard/phases/generate_manifests.py` — confirmed `APP_RUNTIME_SECRET_KEYS` is
   imported from `_manifests.py`, the configmap renders three keys, and the probe uses httpGet
   `/api/health` on port 3000 when `use_http_probe=True`.
8. Read `wizard/wizard/phases/_manifests.py` — confirmed `APP_RUNTIME_SECRET_KEYS =
   frozenset({"discord_client_secret", "app_session_secret"})` (line 40), `render_configmap`
   produces `DISCORD_CLIENT_ID`, `APP_DOMAIN`, `DATABASE_PATH` (lines 65-67), and
   `render_statefulset` has `runAsUser: 1000` and `fsGroup: 1000` with probe at `/api/health`.
   Confirmed `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` is NOT rendered anywhere in the wizard.
9. Read `K8s/statefulset-web.yaml` — confirmed `runAsUser: 1000`, `fsGroup: 1000`, PVC at
   `/data`, port 3000, `envFrom` from both `eloup-web-config` and `eloup-web-secret`.
10. Read `/Users/brandonholcombe/.claude/projects/-Users-brandonholcombe-kodloki-eloup/memory/
    mobile_first.md` — confirmed Lighthouse ≥ 90 mobile, ≤150KB first-paint JS, 44px tap targets,
    iOS safe-area as hard constraints.
11. Read `/Users/brandonholcombe/.claude/projects/-Users-brandonholcombe-kodloki-eloup/memory/
    cluster_conventions.md` — confirmed port 3000, PVC mount on /data, proxy-cookie-domain: "off"
    (OAuth cookie concern, present in ingress template).
12. Ran `python3 scripts/align.py status` — output: "All symbols aligned." Lock is current.
13. Cross-checked the file tree against the route table to discover the [id]/confirm mismatch.
14. Checked the `manifest.webmanifest` icon purpose values against the W3C spec.
