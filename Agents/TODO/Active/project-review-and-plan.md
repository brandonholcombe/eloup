# EloUp — Project Review, Technical Plan & Open Questions

## Author: claude-opus-4.7-planner
## Status: In Progress

> This document is the **planning artifact** the user asked for. It is intentionally not yet a build instruction. It needs:
> 1. an independent review (different agent → `Agents/Review-reports/`),
> 2. user answers to the **Clarifying Questions** section,
> 3. updates to `symbols/manifest.json` reflecting confirmed decisions,
>
> before any code in `src/`, `scripts/`, `k8s/`, `config/` is written. The review gate enforces this.

---

## 1. Scope Summary

The user is asking for **two related deliverables**, plus a deferred third:

| # | Deliverable | Notes |
|---|-------------|-------|
| A | **Deployment wizard / installer** — packaged as a **Docker image** the operator runs locally (`docker run -it ...`), with restartable graceful-failing flow. Inputs: kubeconfig + API keys + Gitea PAT + GitHub PAT + DockerHub PAT. Outputs: a fresh git repo created on **both** Gitea (`haxley.luckyenough.us`) and GitHub, AMD64 images built & pushed to DockerHub, k8s manifests applied via ArgoCD. | This is what gets built first. |
| B | **EloUp web app** — **mobile-first, PWA-installable** multi-game ELO tracker, Discord OAuth, tournaments, hidden ELO-betting feature. The primary surface is a phone held by a party guest standing in someone's backyard — not a laptop. Desktop is a secondary enhancement. | The thing the wizard deploys. |
| C | **KYTO heart-rate dashboard on a Raspberry Pi** — separate deployment, BLE chest strap → live mobile + 1080p projection view. | Deferred — user will provide KYTO docs. Capture as TODO only. |

These reshape three already-locked symbols (`auth`, `architecture`, `deployment`) and add new ones (`tournaments`, `betting`, `heart_rate`). Symbol updates happen **after** the user answers the questions in §6.

---

## 2. Anticipated Symbol Changes

The current `symbols/manifest.json` says: per-player login, single Next.js + SQLite process, deploy host TBD. The new requirements break some of that. Implementer should expect to:

- **`auth`** — replace `model: per_player_login` with `model: discord_oauth`; add `provider: discord`, `scopes: ["identify", "email"]`, `require_verified_email: true`, `roles: [user, tournament_admin, global_admin]`; keep `result_confirmation` semantics but reconsider whether confirmation is still required when **any authenticated user** can enter a match (see Q-AUTH-2).
- **`architecture`** — add `orchestrator: kubernetes`, `gitops: argocd`, `image_registry: dockerhub`, `image_arch: linux/amd64`. Decide DB question (Q-ARCH-1) — likely keep SQLite on a PVC for MVP or switch to Postgres if multi-replica is needed.
- **`deployment`** — replace "host TBD" with the concrete cluster + conventions discovered on **2026-05-09** by inspecting the live cluster and sibling app manifests. Set:
  - `host: linode_lke`
  - `cluster: tow-c1` (region `us-sea-2`, k8s 1.33, 3 AMD64 nodes)
  - `shared_cluster: true` (also runs captain-sonar, shine, secret-santa, windrose, monitoring, argocd, cert-manager, ingress-nginx)
  - `namespace: eloup`
  - `host_pattern: "<app>.kodloki.io"` → eloup will live at **`eloup.kodloki.io`**
  - `ingress_class: nginx`
  - `cluster_issuer: letsencrypt-prod`
  - `storage_class: linode-block-storage-retain` (CSI, retain reclaim, expansion supported)
  - `image_registry: docker.io`, `image_prefix: bholcombe/eloup-`
  - `gitops_archetype: shine_flat` (single-namespace flat YAMLs in `K8s/`) for MVP — graduate to captain-sonar's overlay archetype only when a staging environment is needed
  - `git_hosts: ["gitea_haxley", "github"]` — every push goes to both. **Canonical remote for ArgoCD: GitHub** (proposed default; flip via Q-WIZ-12). Gitea repo: `https://haxley.luckyenough.us/<owner>/eloup`. GitHub repo: `https://github.com/brandonholcombe/eloup.git`.
  - `wizard_packaging: docker_image` — `bholcombe/eloup-wizard:latest`, AMD64, run locally via `docker run -it`
  - LoadBalancer external IP (single shared NodeBalancer): `172.232.176.47` — DNS for `eloup.kodloki.io` must point here
- **NEW `tournaments`** — bracketing rules, admin delegation model.
- **NEW `betting`** — wager source (per-game ELO vs overall ELO), cap rule (≤ max ELO at stake among any participant), settlement timing, the "secret UI" entry point.
- **NEW `heart_rate`** — Pi-side service + dashboard contract. Stub pending KYTO docs.

After the user answers Q-* below, update `symbols/manifest.json`, the corresponding `docs/*.md`, and run `python scripts/align.py lock` in the **same commit**.

---

## 3. High-Level Architecture

```
                  ┌──────────────────────────────────┐
                  │  The Wizard — Docker container   │
                  │  `docker run -it bholcombe/      │
                  │     eloup-wizard:latest`         │
                  │  mounts: ~/.kube, ~/.config/     │
                  │          eloup-wizard, $PWD      │
                  │  - reads kubeconfig              │
                  │  - prompts for API keys          │
                  │  - resumable state file          │
                  └──┬───────────────────────────────┘
                     │ creates repo on BOTH:
                     │   - haxley.luckyenough.us (Gitea)
                     │   - github.com
                     │ pushes generated manifests to both
                     │
                     │ build & push image
                     ▼
       ┌────────────────────────┐         ┌──────────────────────┐
       │   DockerHub (AMD64)    │  ◄───── │  Local buildx /      │
       │   eloup-web:<sha>      │         │  in-cluster Kaniko   │
       │   eloup-pi-hr:<sha>    │         │  (Q-WIZ-3)           │
       └─────────┬──────────────┘         └──────────────────────┘
                 │ pulled by
                 ▼
       ┌──────────────────────────────────────────────┐
       │  Kodloki LKE cluster (shared)                │
       │  also hosts: captain-sonar, shine, others    │
       │  ┌──────────────────────────┐                │
       │  │  ArgoCD (assumed already │                │
       │  │  installed) watches      │                │
       │  │  gitops repo  ─────────┐ │                │
       │  └────────────────────────┼─┘                │
       │  ┌────────────────────────▼──┐               │
       │  │  eloup namespace          │               │
       │  │  - eloup-web Deployment   │               │
       │  │    (Next.js, Node 20)     │               │
       │  │  - PVC (linode-block-     │               │
       │  │    storage-retain)        │               │
       │  │  - Ingress (shared        │               │
       │  │    controller + cert-mgr) │               │
       │  └───────────────────────────┘               │
       └──────────────────────────────────────────────┘
                 ▲ websocket / SSE
                 │
       ┌─────────┴──────────────┐
       │  Raspberry Pi (ARM)    │
       │  reads KYTO via BLE    │
       │  pushes HR samples     │   ← deferred until KYTO docs land
       │  serves projection UI  │
       └────────────────────────┘
```

Two repos (proposed — confirm in Q-WIZ-1):

1. **App repo** (this one) — Next.js source, the wizard, Pi service source.
2. **GitOps repo** — generated manifests + Kustomize/Helm overlays. ArgoCD points here. The wizard pushes to it.

---

## 4. Component Plan

### 4.1 The Deployment Wizard

**Packaging:** the wizard is itself a Docker image (`bholcombe/eloup-wizard:latest`, AMD64) the operator runs locally:

```bash
docker run --rm -it \
  -v ~/.kube:/root/.kube:ro \
  -v ~/.config/eloup-wizard:/root/.config/eloup-wizard \
  -v $(pwd):/workspace \
  bholcombe/eloup-wizard:latest
```

Why a container instead of a `pip install`-able Python package: pins exact versions of `kubectl`, `docker buildx`, `git`, and `argocd` CLI; one artifact for any operator on any OS; matches the org's "everything is a Docker image" pattern. The wizard image is itself produced by a `Dockerfile` in this repo and published to DockerHub via the same build step that builds eloup-web (bootstrap-by-checkout: first run uses `docker build` locally; subsequent runs `docker pull`).

**Goal:** one `docker run` command walks the operator from "I have a cluster + API keys" to "EloUp is live at `eloup.kodloki.io`."

**Phases (each idempotent, each restartable):**

1. **Preflight** — verify mounted kubeconfig works (`kubectl auth can-i`), verify Docker socket reachable from inside the container *or* prefer in-cluster Kaniko build (Q-WIZ-3), verify network reach to DockerHub, Gitea (`haxley.luckyenough.us`), and GitHub.
2. **Collect secrets** — interactive prompts (or `--config /workspace/wizard.yaml`): DockerHub user/PAT, **Gitea PAT**, **GitHub PAT**, Discord OAuth client ID + secret, app domain, optional cert email, app session secret. Persist to `~/.config/eloup-wizard/state.json` with `0600` (mounted from host).
3. **Provision repos on BOTH hosts** — call Gitea API (`POST {haxley}/api/v1/user/repos`) and GitHub API (`POST /user/repos`) to create the eloup repo on each. Idempotent: if either repo already exists, skip creation but verify push access. Configure two remotes: `gitea` and `github`. **Canonical for ArgoCD: GitHub** (matches existing org pattern — Q-WIZ-12 to override). After every git push, the wizard pushes to **both** remotes so they stay in sync. **Per-remote state granularity:** the state file tracks each remote independently as `phase3.gitea_repo: {pending|done}` and `phase3.github_repo: {pending|done}` (NOT a single phase-level `done`), so a crash between the two API calls resumes correctly. Same applies to phase 7 push: `phase7.push_gitea` and `phase7.push_github` tracked independently.
4. **Cluster bootstrap** — detect ArgoCD, ingress-nginx, cert-manager (already present on tow-c1 — see Q-WIZ-5 resolution). Skip install. Add a repo credential secret to ArgoCD only if Q-WIZ-12 selects Gitea as canonical (currently ArgoCD only has GitHub creds for `cptsonar`).
5. **Build & push images** — build AMD64 images for `bholcombe/eloup-web` (and the wizard itself on first bootstrap) via `docker buildx build --platform linux/amd64 --push`. Tag with git SHA + `latest`. Skip if SHA already present in registry.
6. **Generate manifests** — render manifests into the local repo following **shine's flat layout** (`K8s/*.yaml`): `namespace.yaml`, `deployment-web.yaml`, `service-web.yaml`, `configmap-web.yaml`, `secret-web.yaml` (template — real values via External Secrets / Sealed Secrets per Q-WIZ-4), `ingress.yaml` (with shine's WebSocket+OAuth annotation block), `pvc.yaml` (sqlite), and the Argo `Application` CRD pointing at the canonical remote.
7. **Push manifests to BOTH remotes** — `git push gitea main && git push github main`. If either push fails, the wizard rolls back the local commit and reports the error per-remote.
8. **Register ArgoCD Application** — `kubectl apply -f` the `Application` CRD pointing at `<canonical-remote>/eloup` path `K8s/`.
9. **Wait for healthy** — poll until ArgoCD reports `Synced/Healthy`, then print `https://eloup.kodloki.io`.

**Resumability:** every phase writes `{phase: "build_images", status: "done", artifacts: {...}}` to the state file. **Phases with multiple external side effects (3, 7, 8) MUST track sub-step status independently** (e.g. `phase3.gitea_repo`, `phase3.github_repo`; `phase7.push_gitea`, `phase7.push_github`; `phase8.dns_record_created`) so a crash between two side effects resumes at the right step rather than re-running the whole phase. On restart the wizard resumes at the first non-`done` step. `--retry-from <phase>` and `--reset` flags for explicit overrides.

**Graceful failure:** every phase has a `cleanup_on_fail` hook (partial git commits rolled back, half-applied CRDs torn down) UNLESS `--keep` is set. Repo creation is **not** rolled back automatically (deleting a fresh repo is destructive enough to require an explicit `--rollback-repos` flag). Errors are written to a log file and surfaced with the suggested next command.

**Implementation language inside the image:** Python 3.11+ with `click` (CLI), `rich` (TTY rendering), `requests` (Gitea + GitHub APIs), `kubernetes` (k8s API), `subprocess` for `kubectl`/`docker`/`git`/`argocd` CLI calls. The Docker base image is `python:3.11-slim` plus pinned `kubectl`, `argocd`, `docker` (client only), and `git`.

### 4.2 EloUp Web App

**Mobile-first design principles (hard constraint, not a nice-to-have):**

- **Primary breakpoint is portrait phone** (≤ 414px). Tablet and desktop are progressive enhancements layered on top, not the design baseline.
- **Bottom navigation** for primary destinations (Leaderboards / Matches / Tournaments / Profile). No top hamburger as the only nav.
- **Tap targets ≥ 44×44px**, generous spacing between actions, no hover-only affordances.
- **One-handed operation**: every common flow (log a match result, confirm a pending match, see your ELO) must be reachable with the thumb of the hand holding the phone.
- **Respect iOS safe-area insets** (`env(safe-area-inset-top/bottom/left/right)`) so content isn't hidden behind the notch or home indicator.
- **PWA-installable** with `display: standalone`, web app manifest, maskable icons, splash screens. Service worker caches the app shell + last-seen leaderboards (read-only offline per Q-APP-2).
- **iOS install hint**: iOS doesn't fire `beforeinstallprompt`. When `navigator.standalone === false` and the user-agent is iOS Safari, show a one-time custom hint that says "Tap the Share button → Add to Home Screen." Don't badger users who've already installed (`navigator.standalone === true`) or dismissed.
- **Performance budget**: Lighthouse mobile score ≥ 90; first-contentful-paint < 2s on a throttled 3G profile; ≤ 150KB of JS on the first paint of any route.
- **The 1080p projection dashboard is a separate route** (`/projection/match/<id>`), not a responsive variant of the mobile view. Two surfaces, two layouts.
- **Hidden-betting reveal gesture (Q-BET-1) must be touch-native** (long-press, multi-tap on a hidden hit area) — keyboard-only options like a Konami code are off the table since the primary device has no keyboard.

**Stack** (mostly already locked, additions noted):
- Next.js (App Router), Node 20, TypeScript.
- DB: SQLite via `better-sqlite3` on a PVC **OR** Postgres — pending Q-ARCH-1.
- Auth: Discord OAuth via `next-auth` (or Auth.js) using the built-in Discord provider. Scopes: `identify email`. Sign-in requires `verified === true` on the returned email. The Discord user `id` (snowflake) is the stable FK — never the username/handle, which users can change. Sessions via DB adapter. First-login bootstraps a `players` row.
- Server actions for state changes; route handlers for the public REST surface the Pi service uses.
- WebSocket / SSE channel for live heart-rate fan-out (Q-HR-1).
- PWA: `next-pwa` plugin or hand-rolled service worker + manifest. Installable on iOS/Android.
- Styling: Tailwind + a small component lib (shadcn/ui is the obvious pick — confirm in Q-APP-3).

**Domain model (extension of `docs/architecture.md`):**

```
players(id, discord_id UNIQUE, discord_handle, display_name, email, email_verified BOOL,
        avatar_url, role, created_at)
games(id, name, slug, default_k, format ENUM('1v1','ffa','team'),
      min_participants, max_participants, created_at)
matches(id, game_id, tournament_id NULL, status ENUM('scheduled','pending','confirmed','disputed','cancelled'),
        scheduled_at NULL, started_at NULL, ended_at NULL, created_by, created_at)
match_participants(match_id, player_id, team_label NULL, placement INT NULL,
                   score NUMERIC NULL, rating_before, rating_delta, confirmed_at NULL)
ratings(player_id, game_id, current_rating, games_played, last_match_id)  -- denormalized
overall_ratings(player_id, current_rating, last_match_id)                  -- derived
tournaments(id, name, slug, owner_id, format, invite_token, created_at, ends_at NULL)
tournament_admins(tournament_id, player_id)
tournament_members(tournament_id, player_id, joined_at)
bets(id, match_id, bettor_id, side, amount_elo, status ENUM('open','won','lost','void'),
     placed_at, settled_at)
heart_rate_samples(match_id, player_id, ts, bpm, source_device)  -- deferred
```

**Key behaviors:**
- **Match entry before start** → `status=scheduled`, betting window open.
- **Match entry after end** → `status=pending`, betting closed (no bets ever placed); confirmation flow per existing `auth.md` (re-evaluate per Q-AUTH-2).
- **Live match** → `status=pending` once started, locks bets.
- **Confirmation** moves `status=pending` → `confirmed` and only then runs the ELO update + bet settlement, atomically.
- **ELO computation** stays per-`docs/rating.md` (per-game, K=32 default, K÷(n−1) for >2-player). Overall ELO recomputed as a weighted aggregate (Q-RATE-1).
- **Hidden betting UI**: render no betting controls by default. Reveal triggered by an explicit gesture (long-press logo, konami sequence, or `/?bet=on`) — see Q-BET-1.
- **Bet cap rule**: server-side ceiling = `max(|rating_delta_potential|)` across participants for the given match (computed at bet placement). Bets violating this are rejected.
- **Bet escrow + overall-ELO floor (added 2026-05-09 from review feedback):**
  - At **placement**: debit `bets.amount_elo` from `overall_ratings.current_rating` immediately and credit it to a new `overall_ratings.escrowed_elo` column. The cap check uses `current_rating` (post-debit), so a player cannot place multiple open bets totaling more than their available balance across simultaneous matches.
  - At **settlement (`pending → confirmed`)**: a winning bet returns `amount_elo` from escrow back to `current_rating` plus the corresponding payout (paid by losing bettors); a losing bet's escrowed amount is forfeited and credited to the pool of winners. A `disputed`/`cancelled` match returns escrow 1:1 to the bettor.
  - **Floor: `overall_ratings.current_rating` cannot go below 0.** A player whose available balance is 0 cannot place new bets. Match-driven ELO updates also clamp at 0 (rare, but possible if a low-rated player loses to someone wildly stronger). Implementer: add a CHECK constraint in the DB layer.
  - Implication for the schema: extend `overall_ratings` with `escrowed_elo NUMERIC NOT NULL DEFAULT 0` and a CHECK constraint `current_rating >= 0`.

**Roles & permissions:**

| Action | Anonymous | User | Tournament admin | Global admin |
|---|---|---|---|---|
| View leaderboards | ✓ | ✓ | ✓ | ✓ |
| Enter a match | — | ✓ | ✓ | ✓ |
| Confirm own participation | — | ✓ | ✓ | ✓ |
| Edit any match in their tournament | — | — | ✓ | ✓ |
| Edit any match anywhere | — | — | — | ✓ |
| Add/edit games | — | — | — | ✓ |
| Place bets (when feature revealed) | — | ✓ | ✓ | ✓ |

Bootstrap of the first global admin: env var `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` (or `_EMAIL`) consumed once at first matching login (Q-AUTH-3). Discord ID is preferred since it's stable and unique; email is a fallback if you don't want to look up your snowflake.

### 4.3 Raspberry Pi Heart-Rate Dashboard

**Deferred — TODO until KYTO documentation is provided.**

Skeleton expectations:
- Pi runs a small service (Node or Python) that connects to the KYTO chest strap via BLE and pushes `{match_id, player_id, ts, bpm}` samples to the eloup server over an authenticated WebSocket.
- The same Pi (or any browser pointed at it) renders a 1080p projection view + responsive mobile view of the live match.
- Built as ARM64 image, separate `Application` CRD in ArgoCD, pinned to a node label `role=projection`.
- The wizard should generate placeholder manifests + a README block so this is wireable later without re-running the full installer.

---

## 5. Phasing / Milestones

| Milestone | What's done | Gating |
|---|---|---|
| **M0** | This planning doc reviewed; questions in §6 answered; symbols + lock updated | review report in `Agents/Review-reports/`, user answers |
| **M1** | Wizard skeleton: phases 1–2 (preflight + secret collection) working with state file | review of wizard task |
| **M2** | Wizard phases 3–4: cluster bootstrap, build & push to DockerHub | DockerHub access confirmed |
| **M3** | Wizard phases 5–7: manifest generation, ArgoCD sync, healthy URL | gitops repo decided |
| **M4** | EloUp web app MVP: Discord OAuth, players, games, matches, per-game + overall ELO, leaderboards, PWA install (iOS + Android) | DB schema reviewed |
| **M5** | Tournaments + admin delegation + invite links | tournament rules confirmed |
| **M6** | Hidden betting feature behind reveal gesture | reveal mechanism + cap rule confirmed |
| **M7** | KYTO Pi service + projection dashboard | KYTO docs received |

Each milestone is its own task doc in `Agents/TODO/Active/` with its own review report.

**M0–M1 are done as of 2026-05-09** under this single planning doc. From M2 onward, every milestone gets its own per-milestone task doc (e.g. `m2-wizard-phases-3-5.md`) with `## Author: <implementer>` and a separate review report from a different agent. This keeps the review-gate hook protective of each milestone's source-file edits. This planning doc remains `## Status: In Progress` as the umbrella reference until all milestones land; do NOT mark it `Complete` early — that would skip the gate for later milestones.

---

## 6. Clarifying Questions

> Please answer inline (or copy answers into a follow-up message). Grouped by area. Defaults shown in **bold** are what I'd pick if you say "you decide."

### Wizard (WIZ)

- **Q-WIZ-1.** Repo layout (mirrored on both Gitea + GitHub): **(a) one repo, manifests at `K8s/` alongside app source** (matches shine — single source of truth, ArgoCD points at `K8s/` path), (b) one repo with `app/` + `gitops/` top-level dirs, (c) two separate repos (`eloup` + `eloup-gitops`).
- **Q-WIZ-2.** Wizard packaging: **(a) Docker image `bholcombe/eloup-wizard:latest`, run via `docker run -it ...`** (matches the user's "have this as a docker" request — recommended), (b) `pip install eloup-wizard` Python package, (c) static Go binary. Implementation language inside whichever package: **Python 3.11 + click + rich**.
- **Q-WIZ-3.** Image build location: **(a) local Docker buildx via the host's Docker socket mounted into the wizard container** (`-v /var/run/docker.sock:/var/run/docker.sock`) — fastest, simplest; (b) Kaniko job inside the cluster (no Docker socket needed, fully sandboxed); (c) defer to GitHub Actions later. (a) is recommended for the bootstrap path, (c) for ongoing CI.
- **Q-WIZ-4.** ✅ **DECIDED: Sealed Secrets.** Encrypted blobs are safe to commit to both Gitea + GitHub (the dual-remote model makes plain-Secret-not-committed approaches awkward — secrets would diverge between operators). Implications for M2/M3: (i) wizard's phase 4 cluster bootstrap detects the `bitnami-labs/sealed-secrets` controller in the cluster and offers `--install-sealed-secrets` if missing (one-time per cluster); (ii) wizard image must include the `kubeseal` CLI so phase 6 can encrypt `secret-web.yaml` before it's committed; (iii) the public cert needs to be fetched from the controller's `sealed-secrets-key*` Secret (or via `kubeseal --fetch-cert`) and cached.
- **Q-WIZ-5.** ~~Cluster platform components~~ **resolved on 2026-05-09 by reading the live cluster:** ArgoCD, cert-manager (`letsencrypt-prod` ClusterIssuer), and ingress-nginx (`IngressClass: nginx`) are all installed and shared. Default StorageClass is `linode-block-storage-retain`. The wizard will detect-and-skip these. **No action needed unless this should change.**
- **Q-WIZ-6.** Convention archetype — **proposed: mirror shine's flat layout** (`K8s/*.yaml`, single namespace `eloup`, ingress with the websocket+OAuth annotation block shine already uses) for MVP, since EloUp is a single-prod single-replica app. Captain-sonar's `infrastructure/k8s/{base,overlays/...}` layout is overkill until we add staging. **Confirm**, or specify "use captain-sonar's overlay layout from day one."
- **Q-WIZ-7.** Domain — **proposed: `eloup.kodloki.io`** (matches `<app>.kodloki.io` convention used by `shine.kodloki.io`, `sonar.kodloki.io`, etc.). Two questions:
  - ✅ **DECIDED by DNS probe (2026-05-09):** No wildcard. Each app has its own explicit A record (`shine`, `sonar`, `argocd` all → `172.232.176.47`); `eloup.kodloki.io` returns NXDOMAIN today. **DNS is hosted at Linode** (NS: `ns1-5.linode.com`). Default plan: the wizard creates the A record via the Linode DNS API using the operator's Linode PAT (idempotent — skips if already pointing at `172.232.176.47`). `--skip-dns` flag opts out so the operator can handle DNS out-of-band. Confirm or override.
- **Q-WIZ-8.** ✅ **DECIDED:**
  - GitHub: `https://github.com/brandonholcombe/eloup.git`
  - Gitea (haxley): `https://haxley.luckyenough.us/brandonw.h2o/eloup` — owner is **`brandonw.h2o`** (lowercase, per user). README's `Brandonw.h2o/baseline` link still works because Gitea username resolution is case-insensitive; canonical form is lowercase.
- **Q-WIZ-9.** Image registry — **proposed: DockerHub under `bholcombe/eloup-web`** (and `bholcombe/eloup-wizard`, `bholcombe/eloup-pi-hr`) following the `bholcombe/<app>-<component>` pattern shine uses. Confirm DockerHub user `bholcombe` is correct and that you can supply a PAT.
- **Q-WIZ-10.** Where should the wizard store its resumable state file? **(a) `~/.config/eloup-wizard/state.json` on the host (mounted into the container)**, (b) a ConfigMap in `eloup` namespace, (c) both (host file is canonical, ConfigMap is a mirror).
- **Q-WIZ-11.** Gitea API: confirm `https://haxley.luckyenough.us/api/v1/...` is reachable and you can issue a PAT with `write:repository` + `write:user` scopes. Also: should the wizard use Gitea's `webhook` API to wire push notifications back to ArgoCD if Gitea ends up being canonical?
- **Q-WIZ-12.** ✅ **DECIDED: GitHub is canonical** (Gitea is mirror, no ArgoCD repo-cred changes needed, no cluster→haxley network dependency).
- **Q-WIZ-13.** ✅ **DECIDED: (c) canonical wins, mirror failures are warnings.** GitHub push success → phase 7 marks `done` even if the Gitea mirror push failed (recorded as a warning + non-fatal `phase7.push_gitea = "failed"` substep status the operator can `--retry-from push_manifests` later). GitHub push failure is fatal regardless of Gitea state. ArgoCD watches GitHub so it stays consistent with what got pushed.

### Architecture (ARCH)

- **Q-ARCH-1.** ✅ **DECIDED: SQLite on PVC, single replica StatefulSet.** Matches existing locked `architecture.db: sqlite` symbol. Implementer must use a `StatefulSet` (not `Deployment`) so the PVC binding is stable across pod recreates, and set `strategy.type: Recreate` semantics (StatefulSet's default rolling will work since `replicas: 1`). Accept brief downtime during pod recreates / image upgrades. Storage class: `linode-block-storage-retain`. Volume size proposal: **5Gi** (huge headroom for party-scale; bumpable since the SC supports expansion).
- **Q-ARCH-2.** Backups: file copy to S3-compatible bucket nightly? What credentials/bucket do we have?
- **Q-ARCH-3.** Image arch: confirm **`linux/amd64` only** for the web app; Pi service will be `linux/arm64`. Do you want multi-arch images regardless?

### Auth & Roles (AUTH)

- **Q-AUTH-1.** Discord OAuth scopes: **`identify email` only** (no `guilds`/`connections`)? Adding `guilds` later would let us gate sign-up to members of a specific Discord server — say if you want that and we'll include it.
- **Q-AUTH-2.** Current `auth` symbol requires *all participants* to confirm a match before ratings move. With Discord OAuth + "any authenticated user can enter a match," do you want to: **(a) keep the all-participants confirmation requirement**, (b) drop confirmation entirely (creator's word is canon, admins can edit), or (c) confirmation required only for matches not entered by a participant?
- **Q-AUTH-3.** First global admin: **(a) `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` env var, first matching login is promoted** (most stable; requires looking up your snowflake once), (b) `ELOUP_BOOTSTRAP_ADMIN_EMAIL` env var (easier to type, but breaks if you change emails), (c) the wizard prompts for it at install time and bakes it into the deployment, (d) anyone can self-promote until the first admin claims?
- **Q-AUTH-4.** Email-verified requirement: confirm we **reject sign-in if Discord reports `verified === false`**. (Default: yes — keeps drive-by accounts out.)

### App / UI (APP)

- **Q-APP-1.** PWA install prompt: **proactively show install banner on first authenticated load** (Android: native `beforeinstallprompt`; iOS: custom "Tap Share → Add to Home Screen" sheet since iOS doesn't fire that event), or only via browser-native install icon?
- **Q-APP-2.** Offline behavior: **read-only cached leaderboards offline** (writes require network), or full offline write queue (much more complex)?
- **Q-APP-3.** UI library: **Tailwind + shadcn/ui**, Tailwind alone, or something else?
- **Q-APP-4.** Anonymous viewers — should leaderboards be public to non-logged-in users, or auth-required for everything?

### Tournaments (TOURN)

- **Q-TOURN-1.** Is "tournament" really a **bracketed event** (single elim, double elim, round-robin, swiss) with seeding, or just a **named group of matches** with its own admins? If bracketed, which formats?
- **Q-TOURN-2.** Do tournament results feed into the **same per-game ELO** as casual matches, or do tournaments have their **own isolated ELO pool** that resets per tournament?
- **Q-TOURN-3.** Invite link semantics: **(a) single shared link, anyone with it joins**, (b) per-invitee link with name pre-bound, (c) link generates a join request that the tournament admin approves?
- **Q-TOURN-4.** Can a tournament admin **demote/remove** the original creator, or is the creator a permanent super-admin?

### Rating (RATE)

- **Q-RATE-1.** ✅ **DECIDED: (b) overall ELO is its own ELO**, updated on every match using the same algorithm as per-game ELO. Implication: each match runs **two** ELO updates — one against the players' per-game ratings, and one against their overall ratings (with its own K-factor and starting value, both `default_k=32` / `starting=1200` unless we say otherwise). Betting (Q-BET-2) writes/reads this same field, so it's the canonical "wallet."
- **Q-RATE-2.** Team matches up to 8v8 — ELO update model: **(a) update each team member by the same delta computed from team-average ratings**, (b) per-member delta proportional to expected contribution (basically per-player ELO vs team-average ELO of opposition), (c) Glicko-2 / TrueSkill instead of ELO for team formats?
- **Q-RATE-3.** Free-for-all (>2-player, non-team) is currently spec'd as pairwise ELO with K÷(n−1). Confirm we keep this for FFA games like cornhole-with-4 or beer-pong-singles-tournament. (Or is FFA out of scope for MVP?)
- **Q-RATE-4.** What should happen to a player's **per-game ELO** before they've played that game? Default 1200 lazily on first match, or pre-create on signup?

### Betting (BET)

- **Q-BET-1.** Reveal mechanism for the hidden betting UI — must be **touch-native** (mobile-first; no keyboard-only options): **(a) long-press the EloUp logo for 3 seconds**, (b) 5 rapid taps on a fixed corner of the screen (top-right or version footer), (c) URL flag `?bet=on` that sticks per session via localStorage, (d) hidden hit area inside the version footer.
- **Q-BET-2.** ✅ **DECIDED: bettor's overall ELO is the wager currency.** Implication: bets debit/credit `overall_ratings.current_rating`. Need to define how overall ELO is computed first (depends on Q-RATE-1 — currently unanswered). Implementer should make `overall_ratings` a *real, settable* column rather than purely derived, since betting needs to mutate it directly.
- **Q-BET-3.** ✅ **DECIDED: cap = the largest `|rating_delta|` among all participants** (in their per-game ELO; bets are denominated in overall ELO, but the ceiling is set by the largest per-game stake the match creates). User confirmed "largest" on 2026-05-09.
- **Q-BET-4.** Settlement: **all bets settle when match transitions `pending → confirmed`**, voided on `disputed` or `cancelled`. Push payouts to bettor immediately or hold for an admin review window?
- **Q-BET-5.** Can a **participant** in the match place a bet on themselves? (Allowing this enables interesting dynamics; disallowing avoids match-fixing weirdness.)
- **Q-BET-6.** Should bets be visible to other users (open ledger), only to admins, or fully private until settlement?

### Heart Rate (HR — deferred)

- **Q-HR-1.** Will you supply KYTO BLE protocol docs / SDK link? Without them this stays a TODO. (No action needed now — flagged for completeness.)
- **Q-HR-2.** Pi network assumption: **on the same LAN as audience devices**, or always reaches eloup over the public internet? Affects whether the projection page is served from the Pi or from the cluster.

---

## 7. What I Need From You

### ✅ Confirmed so far (2026-05-09)

- Discord OAuth (over Google) — scopes `identify email`, sign-in requires `verified === true`.
- Deploy target: Kodloki LKE cluster `tow-c1`, namespace `eloup`, host `eloup.kodloki.io`.
- Mirror **shine's flat layout** (`K8s/*.yaml`, single namespace) for MVP.
- Wizard packaged as Docker image `bholcombe/eloup-wizard:latest`, run locally.
- Repos created on **both** Gitea (`haxley.luckyenough.us`) and GitHub on every push.
- **Q-WIZ-7 → DNS:** no wildcard; Linode hosts `kodloki.io`; wizard creates `eloup.kodloki.io` A-record → `172.232.176.47` via Linode DNS API (idempotent; `--skip-dns` opt-out).
- **Q-WIZ-8 → repos:** GitHub `brandonholcombe/eloup`, Gitea `brandonw.h2o/eloup`.
- **Q-WIZ-12 → GitHub canonical** for ArgoCD; Gitea is mirror. No ArgoCD repo-cred changes needed.
- **Q-ARCH-1 → SQLite on PVC**, single-replica StatefulSet, `linode-block-storage-retain`, 5Gi.
- **Q-RATE-1 → overall ELO is its own ELO**, updated per match alongside per-game ELO (same `K=32`, `start=1200` defaults).
- **Q-BET-2 → bet currency = overall ELO** (the same field `overall_ratings.current_rating` matches mutate).
- **Q-BET-3 → cap = largest `|rating_delta|`** among participants (in their per-game ELO).

### Still blocking the implementer

**None.** All four critical questions are answered. The implementer can:
1. Write a review report (different `## Reviewer:`) at `Agents/Review-reports/project-review-and-plan-review.md`.
2. Update `symbols/manifest.json` + `docs/*.md` for `auth`, `architecture`, `deployment`, `rating`, plus new `tournaments`, `betting`, `heart_rate` symbols. Run `python scripts/align.py lock`.
3. Split the M0–M7 milestones into per-milestone task docs.
4. Begin implementing M1 (wizard skeleton).

### Nice-to-have (defaults available)

Everything else in §6 has a sensible bold default. The implementer takes the bold answer unless the user pushes back. The only ones with no clear default are Q-AUTH-3 (admin bootstrap mechanism) and Q-TOURN-1 (bracketed event vs named group of matches) — both safe to defer past M1 since they don't affect the wizard.

Once answered, the next agent's job is to:
- write a review report at `Agents/Review-reports/project-review-and-plan-review.md` (different `## Reviewer:` than the `## Author:` above),
- update `symbols/manifest.json` + `docs/*.md` to reflect the confirmed decisions, run `python scripts/align.py lock`,
- split this doc's milestones into per-milestone task docs in `Agents/TODO/Active/`,
- start implementing M1 (wizard skeleton).
