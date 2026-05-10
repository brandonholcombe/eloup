# M2 — Wizard phases 3–5: provision repos, cluster bootstrap, build & push

## Author: claude-opus-4.7-m2-implementer
## Status: Complete

> Implementation plan for milestone M2 of `project-review-and-plan.md`. Touches
> three of the nine wizard phases. The umbrella plan stays In Progress; only
> this task doc moves through the lifecycle.
>
> **Review-incorporation note (2026-05-09):** the independent review at
> `Agents/Review-reports/m2-wizard-phases-3-5-review.md` raised 2 [MAJOR] +
> 4 [MINOR] + 2 [NIT] findings. Sections below have been amended where the
> review changed the plan; "Resolved review notes" at the bottom records
> what changed and why.

---

## Scope

Replace the M1 stubs for **phase 3 (provision_repos)**, **phase 4
(cluster_bootstrap)**, and **phase 5 (build_images)** with real implementations
that match the contract in `project-review-and-plan.md` §4.1, the resolved
clarifying questions (especially Q-WIZ-4 → Sealed Secrets, Q-WIZ-8 → confirmed
repo URLs/owners, Q-WIZ-12 → GitHub canonical), and the recommended follow-ups
in `project-review-and-plan-review.md` (URL-encode the dotted Gitea owner,
keep per-substep state granularity for phase 3).

**Out of scope**: phases 6–9 (manifest gen, dual push, DNS, ArgoCD register +
healthy poll) — these stay as M1 stubs.

---

## Files I'll change

```
wizard/pyproject.toml                  + requests, + responses (dev), + pytest-httpserver (dev)
wizard/wizard/cli.py                   + --install-sealed-secrets flag, thread to PhaseContext
wizard/wizard/phases/base.py           + install_sealed_secrets: bool = False on PhaseContext (dataclass default — keeps M1 tests passing)
wizard/wizard/runner.py                wire up the three real phase classes (drop their stubs)
wizard/wizard/phases/stubs.py          remove ProvisionReposPhase, ClusterBootstrapPhase, BuildImagesPhase
wizard/wizard/phases/provision_repos.py    NEW — phase 3 (Gitea + GitHub API + git remotes)
wizard/wizard/phases/cluster_bootstrap.py  NEW — phase 4 (detect-and-skip + optional sealed-secrets install)
wizard/wizard/phases/build_images.py       NEW — phase 5 (buildx build/push + skip-if-pushed)
wizard/wizard/phases/_http.py              NEW — small requests wrapper (timeouts, JSON, error shape)
wizard/wizard/phases/_git.py               NEW — git remote helpers (subprocess wrappers)
wizard/tests/test_provision_repos.py       NEW
wizard/tests/test_cluster_bootstrap.py     NEW
wizard/tests/test_build_images.py          NEW
Dockerfile                             + pinned kubeseal install; update header comment listing bundled tools
symbols/manifest.json                  deployment.secret_management = "sealed_secrets",
                                       deployment.sealed_secrets_version = "v0.27.1"
symbols/manifest.lock                  regenerated via `python3 scripts/align.py lock`
```

No new top-level scripts, no `k8s/` or `config/` writes — those belong to
M3+. The only `scripts/` interaction is **running** `scripts/align.py lock`,
not editing it.

---

## Phase 3 — provision_repos

**Inputs:** `state.config` (no relevant fields yet), `secrets.json` →
`gitea_pat`, `github_pat`. Working tree at `/workspace`.

**Constants** (module-level, top of `provision_repos.py`):
- `GITEA_BASE_URL = "https://haxley.luckyenough.us"`
- `GITEA_OWNER = "brandonw.h2o"`  (lowercase per Q-WIZ-8)
- `GITHUB_API_BASE = "https://api.github.com"`
- `GITHUB_OWNER = "brandonholcombe"`
- `REPO_NAME = "eloup"`
- `WORKSPACE_DIR = Path("/workspace")`

**Substep `gitea_repo`:**
1. `POST {GITEA_BASE_URL}/api/v1/user/repos` with `Authorization: token <pat>`,
   body `{"name": "eloup", "private": false, "auto_init": false,
   "default_branch": "main"}`.
2. Acceptable statuses: `201 Created` → mark done. `409 Conflict` → fall
   through to existence check.
3. `GET {GITEA_BASE_URL}/api/v1/repos/{quote(GITEA_OWNER, safe='')}/{REPO_NAME}` →
   200 + `permissions.push == true` → done. Otherwise fail with the API
   error body.
4. `state.set_substep_status("provision_repos", "gitea_repo", "done")`.

**Substep `github_repo`:**
1. `POST {GITHUB_API_BASE}/user/repos` with `Authorization: Bearer <pat>` and
   `Accept: application/vnd.github+json`, body
   `{"name": "eloup", "private": false, "auto_init": false,
   "default_branch": "main"}`.
2. Acceptable statuses: `201 Created` → done. `422 Unprocessable Entity`
   with `errors[].message == "name already exists on this account"` → fall
   through to existence check.
3. `GET {GITHUB_API_BASE}/repos/{GITHUB_OWNER}/{REPO_NAME}` → 200 +
   `permissions.push == true` → done.
4. `state.set_substep_status("provision_repos", "github_repo", "done")`.

**Local git remotes** (only after both substeps are done — do this once at
the end of the phase, not inside either substep, so an API failure doesn't
mutate the working tree):
- Read existing remotes via `git -C /workspace remote -v`.
- If a remote literally named `gitea` exists with a different URL, raise. If
  it matches `https://haxley.luckyenough.us/brandonw.h2o/eloup`, leave it.
  If absent, `git remote add gitea …`.
- Same for `github` against
  `https://github.com/brandonholcombe/eloup.git`. Special case: if `origin`
  exists and points at the GitHub URL, `git remote rename origin github`
  (then verify) — do not leave a duplicate.

**Idempotency / crash recovery:**
- Per-substep status (already declared in `PHASE_DEFINITIONS`). Phase done
  iff `state.all_substeps_done("provision_repos")`.
- On rerun with `gitea_repo=done, github_repo=pending`: skip the Gitea call
  block entirely, run only GitHub.
- Hard fail (don't silently overwrite) if a local remote name collides with
  a different URL — the operator's working tree may legitimately point
  somewhere else.

**Why URL-encode the Gitea owner:** `brandonw.h2o` contains a dot; while
Gitea accepts it in the path, defense-in-depth via `urllib.parse.quote(owner,
safe='')` keeps the client robust to future owner changes.

---

## Phase 4 — cluster_bootstrap

**Detect order** (each via `kubectl … -o json`, parsed in Python):

| # | Component                  | Detection signal |
|---|---------------------------|------------------|
| 1 | ArgoCD                     | namespace `argocd` exists AND deployment `argocd-application-controller` in `argocd` exists |
| 2 | cert-manager               | namespace `cert-manager` exists AND ClusterIssuer `letsencrypt-prod` has `status.conditions[?type=Ready].status == "True"` |
| 3 | ingress-nginx              | IngressClass `nginx` exists with `spec.controller == "k8s.io/ingress-nginx"` |
| 4 | StorageClass               | `linode-block-storage-retain` exists AND has annotation `storageclass.kubernetes.io/is-default-class: "true"` |
| 5 | Sealed Secrets             | CRD `sealedsecrets.bitnami.com` exists AND deployment `sealed-secrets-controller` is `Available=True` in either `kube-system` or `sealed-secrets` namespace |

For each missing component (1–4): collect the failure plus the exact
`kubectl apply -f …` command the operator would run, render a Rich table at
the end, raise `PhaseFailed`. **No installation** of these four — the live
cluster already has them and re-installing would clobber org state.

**Sealed Secrets is the one exception.** New CLI flag
`--install-sealed-secrets`. When set AND the controller is missing, apply
the pinned manifest:
- `SEALED_SECRETS_VERSION = "v0.27.1"` (module-level constant)
- `SEALED_SECRETS_MANIFEST_URL = f"https://github.com/bitnami-labs/sealed-secrets/releases/download/{SEALED_SECRETS_VERSION}/controller.yaml"`
- `kubectl apply -f <url>`
- `kubectl -n <ns> rollout status deployment/sealed-secrets-controller --timeout=180s`

Without the flag, missing controller → hard fail with the suggested command
in the error.

**Cert cache:**
After Sealed Secrets is verified present (whether pre-existing or freshly
installed), run
`kubeseal --fetch-cert --controller-namespace=<ns> > <state_dir>/sealed-secrets.crt`,
where:
- `<ns>` is **the namespace bound during detection** — stored in a local
  variable like `controller_ns` and reused for the rollout-status command
  (when installing) AND the cert-fetch command. Do not re-detect.
- `<state_dir>` is `ctx.paths.state_dir` (resolves to
  `~/.config/eloup-wizard` on the host because that directory is mounted
  into the container — see `wizard/wizard/paths.py`). The cert MUST land
  on the host so it survives container exit.

Then `state.update_config({"sealed_secrets_cert_path":
str(state_dir / "sealed-secrets.crt")})`. Phase 6 (M3) reads this path —
this is the M2 → M3 hand-off contract.

**No substeps:** the phase is single-shot pass/fail. Crash recovery is
re-entry — every detection is read-only.

---

## Phase 5 — build_images

**Tagging:**
- `cd /workspace && git rev-parse HEAD` → `<sha>`
- `git status --porcelain` non-empty → `<sha>=<sha>-dirty`, emit Rich
  warning, proceed.
- Tags pushed: `:<sha>` and `:latest` for every image built.

**What we build:**

| Image                          | Build context | Built when                           |
|--------------------------------|---------------|--------------------------------------|
| `bholcombe/eloup-wizard`       | `/workspace` (Dockerfile at repo root) | always |
| `bholcombe/eloup-web`          | `/workspace/eloup-web` (or `/workspace` if `Dockerfile.eloup-web` exists at root) | only if either path is present; otherwise log "eloup-web not yet present (built in M4)" and skip cleanly |

**Skip-if-already-pushed (per image) — performance optimization, NOT a
correctness gate:**
- `GET https://hub.docker.com/v2/repositories/bholcombe/{component}/tags/{sha}`
- 200 → log "image already pushed, skipping" for that image, mark its
  entry in `state.config.last_built_images`, do not invoke buildx.
- 404 or any other status → proceed to build.

This is the DockerHub catalog API (not the OCI distribution API at
`registry-1.docker.io`); it has replication lag after a push and will
404 transiently for images pushed seconds ago. That is **acceptable**:
re-pushing an image that already exists is idempotent at the registry
layer level — buildx will no-op on unchanged layers and re-tag. The
skip is purely to avoid the multi-second buildx invocation on
demonstrably already-pushed SHAs. A code comment in `build_images.py`
will make this explicit so a future reader doesn't assume the skip is
load-bearing for correctness.

**Build flow** (per image to be built):
1. `docker login -u <dockerhub_user> --password-stdin` once at the start
   of the phase (PAT from secrets.json piped via stdin).
2. `docker buildx build --platform linux/amd64 --push
   -t bholcombe/<component>:<sha> -t bholcombe/<component>:latest <context>`.
3. On success, append `{component: {"sha_tag": <sha>, "latest_tag":
   "latest"}}` to `state.config.last_built_images`.
4. After all images are processed, `docker logout` to clear
   `~/.docker/config.json` of the wizard's session.

**No substeps** — but `state.config.last_built_images` is the
M2 → M3 contract (manifest gen reads exact tags from there).

**Auth handling:** the `docker login --password-stdin` pattern keeps the PAT
out of `argv` and the env. A `logged_in` boolean tracks whether the
phase actually called `docker login` — if every image was skipped
(already pushed or absent), login is never invoked and the `finally`
block skips `docker logout` rather than emitting a confusing log line.
On any path where `login` was called, `docker logout` runs in `finally`
so a failed build still clears the credential.

**eloup-web build policy:** skipped if neither `Dockerfile.eloup-web` at
the repo root nor an `eloup-web/` directory is present. No
`--build-eloup-web` flag in M2 — the directory-presence check is the
single source of truth. A flag becomes useful only once the app exists
(M4) and the operator might want to opt out.

---

## Dockerfile changes

- Add a pinned `kubeseal` install (download from
  `bitnami-labs/sealed-secrets v0.27.1` release, install to
  `/usr/local/bin/kubeseal`, chmod 0755, smoke-test `kubeseal --version`).
- Update the header comment block to list all bundled tools (kubectl,
  argocd, docker, kubeseal) with their pinned versions.
- No base-image bump; no other dependency changes.

---

## Test approach

Add `responses` (HTTPS mocking for `requests`) and `pytest-httpserver`
(localhost HTTP server, used for the `kubeseal` cert fetch path) to dev
deps. Keep all tests offline by default; mark live tests with
`@pytest.mark.live` and add a `--live` pytest CLI option that runs them.

**`test_provision_repos.py`:**
- Fresh repo creation on both hosts (mock 201s) → both substeps `done`,
  remotes added.
- Re-run after Gitea succeeded but GitHub failed (state preset:
  `gitea_repo=done`) → only the GitHub call fires, Gitea is not touched.
- Idempotent: pre-existing repos (Gitea 409, GitHub 422 with the literal
  GitHub error message) → existence check succeeds, both done.
- Dotted owner is URL-encoded in the `GET …/api/v1/repos/...` path.
- Local remote conflict (existing `gitea` remote pointing elsewhere) →
  raises with a clear message, neither substep regresses.
- `origin → github URL` is renamed to `github` rather than duplicated.

**`test_cluster_bootstrap.py`:**
- All five components present → phase done, cert path stored in state.
- Each component missing in turn → phase fails, error includes the suggested
  `kubectl apply -f …` command for that component.
- Sealed Secrets missing without `--install-sealed-secrets` → fail.
- Sealed Secrets missing with `--install-sealed-secrets` → apply manifest,
  rollout status, then cert fetch — all subprocess invocations mocked,
  arguments asserted (especially the pinned URL).

**`test_build_images.py`:**
- Wizard image not on DockerHub (404) → `docker buildx build --push`
  invoked with the right tags and platform; `state.config.last_built_images`
  populated.
- Wizard image already pushed (200) → buildx is **not** invoked.
- Working tree dirty → SHA tag carries `-dirty` suffix and a warning is
  emitted (asserted via `caplog` or Rich's recorded console).
- `eloup-web` Dockerfile/dir absent → skipped cleanly, no failure.
- `docker logout` always called on the success path AND the failure path.

**Existing 25 tests** must keep passing.

---

## Verification before reporting done

1. `python3 scripts/align.py check` exits 0.
2. `cd wizard && python3 -m pytest -q` passes (existing 25 + new tests).
3. `python3 -m ruff check wizard/` and `ruff format --check wizard/` clean.
4. `docker build -t eloup-wizard-m2-test .` succeeds.
5. `docker run --rm eloup-wizard-m2-test --help` lists
   `--install-sealed-secrets`.
6. End-to-end live run (gated on user supplying real PATs):
   - phase 3 against a throwaway `eloup-m2-test` repo on both hosts;
   - phase 4 against tow-c1 (kubeconfig at
     `/Users/brandonholcombe/kodloki/tow-c1-kubeconfig (4).yaml`);
   - phase 5 pushing `bholcombe/eloup-wizard:<sha>` to DockerHub.

If real PATs are not supplied, stop and report what's mocked vs what
remains gated rather than fabricating doubles.

---

## Commits

Three commits expected, in this order:

1. **`docs: M2 — wizard phases 3-5 task doc + independent review`** —
   this task doc plus the reviewer's report at
   `Agents/Review-reports/m2-wizard-phases-3-5-review.md`. No code. (The
   reviewer agent ran in this same session and is ephemeral; the
   implementer commits both files. The Author/Reviewer fields in the
   docs themselves remain the independent-review record of truth.)
2. **`feat: wizard phase 3 — provision repos on gitea + github`** — phase
   3 code, helpers (`_http.py`, `_git.py`), tests, pyproject changes
   (requests + responses).
3. **`feat: wizard phases 4-5 — cluster bootstrap + image build/push`** —
   phases 4 and 5 code, Dockerfile (kubeseal), tests, manifest.json +
   manifest.lock updates for `secret_management: sealed_secrets`.

Each commit ends with the
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
trailer.

---

## Resolved review notes

The independent review at
`Agents/Review-reports/m2-wizard-phases-3-5-review.md` produced the
following changes to this plan:

1. **[MAJOR #1]** `PhaseContext.install_sealed_secrets` is declared with
   a dataclass default `= False` so existing M1 tests that construct
   `PhaseContext` keep passing without edits.
2. **[MINOR #2]** Phase 5 spec now states the DockerHub Hub API check is
   a performance optimization, not a correctness gate. A code comment
   in `build_images.py` will repeat this for future readers.
3. **[MINOR #3]** Phase 4 spec now binds the detected Sealed Secrets
   namespace to a local variable and reuses it for both the rollout
   wait and the cert-fetch invocation. `state_dir` is `ctx.paths.state_dir`
   (host-mounted; cert survives container exit).
4. **[MINOR #4]** eloup-web build policy adopted as bold default:
   directory-presence check, no `--build-eloup-web` flag in M2.
5. **[MINOR #5]** `secret_management` and `sealed_secrets_version`
   continue to live on the `deployment` symbol (Sealed Secrets is a
   cluster-infrastructure concern; creating a `secrets` symbol for a
   single-property addition would require defining interlocks that don't
   yet add value).
6. **[NIT #6]** `docker logout` is gated on a `logged_in` boolean so it
   only runs when `docker login` was actually invoked.
7. **[NIT #7]** Commit 1 description updated: it bundles the task doc
   and the review report, with the Author/Reviewer fields inside the
   documents being the independent-review record of truth (the reviewer
   agent doesn't commit; the implementer does).

Coverage gap from the review (test for `--install-sealed-secrets` flag
threading from CLI → `PhaseContext.install_sealed_secrets` → phase
behavior) is folded into `test_cluster_bootstrap.py`'s test list as a
new case.
