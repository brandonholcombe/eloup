# H1 — Hotfix: bootstrap-admin plumbing + admin nav surface

## Author: claude-opus-4.7-h1-implementer

## Status: Not Started

> **Author/Reviewer separation note.** Prior M2–M5 authors are
> `claude-opus-4.7-m2-implementer`, `…-m3-implementer`, `…-m4-implementer`,
> `…-m5-implementer`; prior reviewers are `claude-sonnet-4-6-m2-reviewer`,
> `…-m3-reviewer`, `…-m4-reviewer`, `…-m5-reviewer`. The reviewer for this
> doc must use a `## Reviewer:` field distinct from
> `## Author: claude-opus-4.7-h1-implementer`. Suggested:
> `claude-sonnet-4-6-h1-reviewer` (matches prior convention).

---

## Why this hotfix exists

Two real gaps surfaced on the first real prod login at
https://eloup.kodloki.io:

1. **Bootstrap-admin auto-promotion is dead end-to-end.** M4's
   `lib/auth.ts` line 36 calls
   `bootstrapPlayer(db(), profile, e.ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID)`
   and `lib/db/players.ts` does promote a matching Discord id to
   `global_admin`. But the wizard's `render_configmap` in
   `wizard/wizard/phases/_manifests.py:68` never emits the env var, and
   `wizard.yaml(.template)` has no field for it. M4's task doc explicitly
   said the operator would `kubectl set env` post-deploy; that out-of-band
   step was missed tonight and the operator stayed at `role='user'`.
   Hot-fixed in-cluster via a direct SQL UPDATE; a fresh-cluster install
   would reproduce.
2. **`/games` is unreachable.** `app/games/page.tsx` exists and redirects
   non-`global_admin` to `/leaderboards`, but `components/BottomNav.tsx`
   has no link to it, and the `/profile` page has no admin section
   either. The M4 task doc lists "global_admin adds a game to the
   catalog" as Flow 2 — the route shipped, the surface to reach it did
   not.

Both share the framing "make global_admin actually usable end-to-end."
Bundling as one hotfix.

## Reading of M5 admin scope

M5 §"Cross-cutting — `players.role`" and §"No `/tournaments/[slug]/admin`
sub-route" confirms: tournament admin controls live **inline** inside
`/tournaments/[slug]/page.tsx`. The `/games` catalog is a **global**
resource (Q-APP-2 / M4 Flow 2) and remains global-admin-only in M5. No
per-tournament game catalog exists (out of scope by H1).

→ The new nav link must be gated on `session.user.role === 'global_admin'`
only. `tournament_admin`-derived authority does not unlock `/games`.

---

## Files I'll change

### Phase A — wizard (Python)

| File | Change |
|---|---|
| `wizard/wizard/config.py` | Add `bootstrap_admin_discord_id` to `CONFIG_FIELDS` and `CollectedConfig`. Default `None` — propagates as the dataclass field's `None` when absent from YAML, never `""`. |
| `wizard/wizard/prompts.py` | `_from_yaml_only` reads `data.get("bootstrap_admin_discord_id")` and passes through `None` when missing. `_interactive_collect` prompts for it with an empty-string default that maps to `None` after stripping. |
| `wizard/wizard/phases/_manifests.py` | `render_configmap(*, discord_client_id, app_domain, bootstrap_admin_discord_id=None)` — when truthy, emit `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID: "<value>"` in `data:`. When `None`, omit the key entirely (do NOT emit `: ""`). |
| `wizard/wizard/phases/generate_manifests.py` | Read `config.get("bootstrap_admin_discord_id")` and pass through. |
| `wizard/tests/test_generate_manifests.py` | Two new tests asserting present vs absent ConfigMap key. |
| `~/.config/eloup-wizard/wizard.yaml.template` | Add the new field with comment discipline matching existing entries. Operator-host file only — checked into `/Users/brandonholcombe/.config/`, NOT into the repo. |

### Phase B — eloup-web (TypeScript)

| File | Change |
|---|---|
| `eloup-web/app/profile/page.tsx` | Append an "Admin" section, visible only when `session.user.role === 'global_admin'`, containing a single `Link href="/games"` styled as a row matching the existing `border border-slate-800 bg-slate-900` card pattern. 44×44px min tap target. |
| `eloup-web/tests/unit/profile-admin-section.test.ts` | Render-shape test: import the admin-section helper and assert the link appears only for `global_admin`. (See "Tests" below for shape — Vitest is `.ts` only per `vitest.config.ts`.) |

`BottomNav.tsx` is **deliberately NOT changed**. Rationale below.

---

## The wizard contract change

### Old M3→M4 hand-off contract

ConfigMap keys (per M3 task doc line 124, M4 reviewer report):
- `DISCORD_CLIENT_ID`
- `APP_DOMAIN`
- `DATABASE_PATH`
- `AUTH_URL` *(added in 22f6d49 for Auth.js v5)*
- `AUTH_TRUST_HOST` *(same)*

### New M3→M4 hand-off contract (post-H1)

Same five keys plus an **optional sixth**:

- `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` — emitted only when
  `wizard.yaml.bootstrap_admin_discord_id` is non-empty. Discord
  snowflake (digits only). Consumed by `lib/env.ts`'s
  `z.string().optional()` schema in `eloup-web` — absent key parses as
  `undefined`, and `lib/auth.ts`'s `bootstrapPlayer` no-ops on
  `undefined` (per `lib/db/players.ts:52,67`). The key is omitted when
  unset rather than emitted as `""` to preserve M4's
  optional-vs-required discrimination.

I will append a short note to `Agents/TODO/Active/m3-wizard-phases-6-9.md`
recording the new optional key. M3 status stays Complete; only the
documented contract surface gains a line.

### YAML field shape

```yaml
# Optional: Discord snowflake (digits only) of the operator who should
# be promoted to global_admin on their first sign-in. Leave blank to
# disable auto-promotion (and run a one-shot SQL UPDATE in the pod's
# SQLite to grant yourself global_admin after first sign-in).
#
# To find your snowflake: Discord → Settings → Advanced → Developer
# Mode → right-click your name → Copy User ID.
bootstrap_admin_discord_id: ""
```

When `""` or missing, the field flows through `prompts._from_yaml_only`
as `None`, and `render_configmap` omits the ConfigMap key entirely.

---

## The UI design decision

Choices considered (per the prompt):

| | Option | Verdict |
|---|---|---|
| (a) | BottomNav 5th slot for global_admin | Cramped on phones (5 slots × 64px ≈ ~320px nominal nav width is fine, but the BottomNav already conditionally renders a Sign-In slot when not signed in, and we'd be adding a sixth conditional slot for signed-in admins. Layout permutations grow quadratically.) |
| **(b)** | **`/profile` gains an "Admin" section** | **Picked.** Natural home for future admin tools (audit log, role grants — M6.5+). Doesn't burn primary nav space on a feature 99% of users won't touch. Tap budget: user lands on Profile (1 tap) → tap Admin → Games (2 taps total) is fine for a feature global_admin uses once per game-add. |
| (c) | Swap a slot context-sensitively | Worst — hides primary nav from admins. |
| (d) | Header strip on `/leaderboards` | Wrong surface; leaderboards are anonymous-visible (Q-APP-4) so any conditional admin chrome there has to be hydrated, adding LCP cost for a tiny audience. |

**Picked: option (b).** Add an "Admin" section to `/profile` visible only
to `global_admin`, containing a single `/games` link card. Same card
styling as existing Profile sections (`rounded-md border border-slate-800
bg-slate-900 px-3 py-2`). 44px tap target enforced via `min-h-tap`
(already defined in `tailwind.config.ts`). Visible focus ring inherited
from existing `<Link>` defaults. The slate-900-on-slate-950 contrast
matches existing rows.

### Forward-compat (M6+)

The Admin section is the documented pattern for future global-admin-only
surfaces. M6 (betting) is expected to add a "Bet audit" view; it goes
under this same section. The pattern is:

```tsx
{session.user.role === 'global_admin' && (
  <section className="mt-6">
    <h2 className="text-sm uppercase tracking-wide text-slate-500">Admin</h2>
    <ul className="mt-2 space-y-2">
      <li><Link href="/games" className="…card…">…</Link></li>
      {/* future: /admin/bets, /admin/audit, etc. */}
    </ul>
  </section>
)}
```

---

## Tests

### Wizard (pytest)

Add to `wizard/tests/test_generate_manifests.py`:

1. **`test_phase6_configmap_emits_bootstrap_admin_when_set`** — set
   `state.config["bootstrap_admin_discord_id"] = "481702948146249728"`,
   run phase 6, parse `K8s/configmap-web.yaml`, assert
   `cm["data"]["ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID"] == "481702948146249728"`.
2. **`test_phase6_configmap_omits_bootstrap_admin_when_unset`** — do not
   set the key (or set it to `None`), run phase 6, parse the configmap,
   assert `"ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID" not in cm["data"]`. Also
   assert the rendering does not crash and the other five keys are
   still present.

Optional sanity tests in a new `wizard/tests/test_manifests_render.py`
(or extend `test_generate_manifests.py`) for the pure `render_configmap`
function — present/absent cases, no I/O — to lock the omit-vs-empty
behavior at the renderer boundary rather than only at the phase boundary.

### eloup-web (vitest)

`vitest.config.ts` only includes `tests/**/*.test.ts`, not `.tsx`. The
ProfilePage server component pulls real DB and `await auth()` at module
import, which makes a clean render-shape test painful. Approach:

- Extract a small pure helper `profileAdminLinks(role: Role): {href:string;label:string}[]`
  in `components/ProfileAdminSection.tsx` (or inline in `lib/permissions.ts`).
- `tests/unit/profile-admin-section.test.ts` imports the helper and
  asserts `profileAdminLinks('global_admin')` includes `/games` and
  `profileAdminLinks('user')` is empty.

This is a tighter unit test than a JSDOM render and avoids fighting
Next.js server-component test infra (which the existing test suite
also avoids — see `tests/integration/bootstrap-admin.test.ts` for the
project's testing style: direct module imports, ephemeral SQLite, no
RSC harness).

If we end up wanting a real render assertion later (e2e Playwright in
M5's `e2e/golden-path.spec.ts` is the right place), we add it then —
out of scope for H1.

---

## Migration / re-deploy mechanics

- **Existing prod data is not touched.** The operator who was hand-promoted
  tonight via SQL UPDATE stays at `role='global_admin'`. The wizard
  change only affects how the ConfigMap is rendered on future runs.
- **The ConfigMap update propagates via ArgoCD.** When the operator
  re-runs `wizard --retry-from generate_manifests` (the canonical hotfix
  re-deploy shape per commits `db8c2d8`, `22f6d49`, `1c1d204`), the new
  ConfigMap is committed to the manifests repo, ArgoCD reconciles, and
  the pod needs a restart to re-read the env vars. `kubectl rollout
  restart sts/eloup-web` is the manual step (same pattern as the three
  earlier hotfixes tonight).
- **For a fresh cluster**, `bootstrap_admin_discord_id` in `wizard.yaml`
  is honored from phase 2 onward — no manual SQL UPDATE needed.
- **For a tow-c1 re-deploy after H1 lands**, the operator updates
  `~/.config/eloup-wizard/wizard.yaml` with `bootstrap_admin_discord_id:
  "481702948146249728"`, runs the wizard, and the next pod restart picks
  up the var. The existing player row's `role` is already
  `global_admin` from tonight's hot-fix, so the promotion path is a
  no-op (`maybePromote` in `lib/db/players.ts:64` short-circuits when
  `player.role === 'global_admin'`).

---

## Scope — what gets built

### Phase A — Wizard plumbing
- `config.py`: add `bootstrap_admin_discord_id: str | None = None` to
  `CollectedConfig`; add to `CONFIG_FIELDS`. `to_dict()` already returns
  `asdict()` which preserves `None`.
- `prompts.py`: thread through both `_interactive_collect` and
  `_from_yaml_only`. `None` and empty string both normalize to `None`.
- `phases/_manifests.py`: `render_configmap` signature gains
  `bootstrap_admin_discord_id: str | None = None`. When truthy, append
  the key line. Default `None` keeps existing test call-sites and the
  wizard-internal call in `generate_manifests.py` source-compatible.
- `phases/generate_manifests.py`: pull
  `config.get("bootstrap_admin_discord_id")` (returns `None` when
  absent) and pass through.
- Two pytest cases on the present/absent ConfigMap key path.
- One pytest case on the pure `render_configmap` function.

### Phase B — eloup-web nav surface
- `app/profile/page.tsx`: append the Admin section conditional on
  `session.user.role === 'global_admin'`. Imports `Link` from
  `next/link`.
- `tests/unit/profile-admin-section.test.ts`: assert helper function
  returns `[{ href: '/games', label: 'Games' }]` for `global_admin`
  and `[]` for `user` / `tournament_admin`.
- No new dependencies. No service-worker bundle changes (this is a
  server component; the chunk delta is the `<Link>` import which is
  already shipped via the existing `<Link>` usage in BottomNav).
- No Lighthouse mobile budget impact expected.

---

## Out of scope (per the H1 brief)

- Tournament-scoped game lists (no `tournament_games` table).
- Demoting / un-promoting players, `/admin` panel, role-management UI,
  audit log — M6.5+ if ever.
- Multi-tenant admin (per-tournament admin promoting someone to global).
- Wizard image rebuild orchestration script — verbatim commands in
  Phase A verification section only.
- BottomNav 5th-slot rework. The "Admin" landing inside `/profile` is
  the picked pattern; future admin surfaces extend that section.

---

## Verification

1. `python3 scripts/align.py check` exits 0 (no symbol property changes
   in H1 — `app.first_admin_bootstrap = env_discord_id_optional` already
   reflects the optional env var; no lock regeneration needed).
2. `cd wizard && python3 -m pytest -q` — passes (existing tests + 2–3
   new).
3. `cd eloup-web && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
   — all clean.
4. `docker build` on both `Dockerfile.eloup-wizard` and
   `Dockerfile.eloup-web` succeeds.
5. **Local smoke (wizard side)**: invoke
   `render_configmap(discord_client_id='x', app_domain='y',
   bootstrap_admin_discord_id='481702948146249728')` from a Python
   REPL and grep the output for `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID`.
6. **Live verification on tow-c1** (operator-driven, after merge):
   - Update `~/.config/eloup-wizard/wizard.yaml`:
     `bootstrap_admin_discord_id: "481702948146249728"`.
   - `cd /Users/brandonholcombe/kodloki/eloup && docker build -t bholcombe/eloup-wizard:latest -f Dockerfile.eloup-wizard .`
   - ```
     docker run --rm -i \
       -v /var/run/docker.sock:/var/run/docker.sock \
       -v ~/.config/eloup-wizard:/root/.config/eloup-wizard \
       -v $(pwd):/workspace \
       -v ~/.kube/linode-config:/root/.kube/config:ro \
       -w /workspace bholcombe/eloup-wizard:latest \
       --config /root/.config/eloup-wizard/wizard.yaml \
       --retry-from generate_manifests
     ```
   - `kubectl --kubeconfig=$HOME/.kube/linode-config -n eloup rollout restart sts/eloup-web`
   - `kubectl --kubeconfig=$HOME/.kube/linode-config -n eloup exec eloup-web-0 -- printenv | grep BOOTSTRAP`
     → expect `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID=481702948146249728`.
   - Confirm the existing player row still has `role='global_admin'`
     (hand-promotion from tonight is unaffected).
   - Sign out → sign back in on https://eloup.kodloki.io → tap Profile
     → expect an Admin section with a Games link → tap it → land on
     `/games` → add a placeholder game to confirm the full loop.

---

## Commit shape

Four commits expected (matching M-series):

1. `docs: H1 — admin bootstrap + nav hotfix task doc` (this file only).
2. `docs: H1 — reviewer report` (different agent, gate-required).
3. `fix: wizard ConfigMap — emit ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` —
   wizard half (Phase A) with regression tests.
4. `feat: eloup-web — surface /games for global_admin` — eloup-web half
   (Phase B) with vitest test.

Each commit ends with
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Hand-offs to M6

- **Admin surface pattern.** `/profile` "Admin" section is the canonical
  home for future global-admin-only links. M6's bet-audit view should
  add itself there, not as a new BottomNav slot.
- **`bootstrap_admin_discord_id` wizard.yaml chain.** Future
  operator-installable secrets (e.g. a Stripe key, observability
  tokens) follow the same chain: `wizard.yaml` → `CONFIG_FIELDS`/
  `SECRET_FIELDS` in `wizard/wizard/config.py` → `prompts.py` thread-
  through → `phases/_manifests.py` renderer → `phases/generate_manifests.py`
  call site → ConfigMap (non-secret) or SealedSecret via
  `APP_RUNTIME_SECRET_KEYS` (secret). Pure-string renderers stay
  testable; phases stay opinionated about state.config keys.
