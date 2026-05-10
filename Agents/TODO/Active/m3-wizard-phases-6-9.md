# M3 — Wizard phases 6–9: manifests, push, DNS, ArgoCD register

## Author: claude-opus-4.7-m3-implementer
## Status: In Progress

> Implementation plan for milestone M3 of `project-review-and-plan.md` (§4.1
> phases 6–9). Replaces the four remaining stubs in
> `wizard/wizard/phases/stubs.py` with real implementations. Consumes the
> M2→M3 hand-off contracts (`state.config.sealed_secrets_cert_path`,
> `state.config.sealed_secrets_namespace`, `state.config.last_built_images`)
> and produces the M3→M4 hand-off contract documented at the bottom.
>
> Per the M2 reviewer's NIT #7 (commit-1 split): commit 1 is **task doc
> only**, no review report bundled. The reviewer commits their report
> separately as commit 2; implementer's feature commits become commits
> 3 and 4.
>
> **Review-incorporation note (2026-05-10):** the independent review at
> `Agents/Review-reports/m3-wizard-phases-6-9-review.md` raised 4 [MAJOR] +
> 4 [MINOR] + 2 [NIT] findings. Sections below have been amended where the
> review changed the plan; "Resolved review notes" at the bottom records
> what changed and why.

---

## Scope

Replace four M1 stubs with real implementations matching `project-review-and-plan.md` §4.1 phases 6–9 and the M3 brief decisions:

- **Phase 6 — generate_manifests** — render shine-flat-layout manifests into `K8s/` and a separate ArgoCD `Application` CRD into `argocd/eloup-app.yaml` (separated to avoid a self-sync loop).
- **Phase 7 — push_manifests** — `git add` + commit the rendered files, push to GitHub (canonical, fatal-on-fail), then push to Gitea (mirror, warning-on-fail per Q-WIZ-13). Uses the existing `push_gitea`/`push_github` substep tracking.
- **Phase 8 — dns_record** — idempotent Linode DNS A-record for `eloup.kodloki.io → 172.232.176.47` via the Linode v4 API. New `--skip-dns` flag.
- **Phase 9 — argocd_sync** — apply an ArgoCD `repository`-typed Secret in `argocd` namespace (no admin password collection — recommendation from M2 hand-off Q3), apply the `Application` CRD from phase 6, poll Synced/Healthy with a Rich live update, set `state.config.eloup_url`.

**Out of scope**: the eloup-web Next.js app itself (M4), tournaments (M5), betting (M6), heart-rate (M7). Phase 6 supports a `--web-image <ref>` override exactly so M3's pipeline can be smoke-tested against a placeholder image (e.g. `nginx:1.27-alpine`) before M4 lands.

---

## Files I'll change

```
wizard/wizard/cli.py                       + --web-image, + --skip-dns flags; thread to PhaseContext
wizard/wizard/phases/base.py               + web_image: str | None = None,
                                           + skip_dns: bool = False on PhaseContext (dataclass defaults — keep existing tests passing)
wizard/wizard/runner.py                    drop the four stub imports/instantiations; wire the four new phase classes
wizard/wizard/phases/stubs.py              DELETE (all four stubs are replaced — no remaining users)
wizard/wizard/phases/generate_manifests.py NEW — phase 6 (render shine-flat manifests + argocd app, kubeseal for the SealedSecret)
wizard/wizard/phases/push_manifests.py     NEW — phase 7 (commit + dual-remote push with canonical-wins semantics)
wizard/wizard/phases/dns_record.py         NEW — phase 8 (Linode DNS API; idempotent)
wizard/wizard/phases/argocd_sync.py        NEW — phase 9 (kubectl apply Secret + Application; poll healthy)
wizard/wizard/phases/_manifests.py         NEW — pure-string manifest templates + render helpers (no I/O — keeps phase 6 testable)
wizard/wizard/phases/_kubectl.py           NEW — small kubectl wrapper (apply-from-stdin, get-json) shared by phases 4, 8, 9
wizard/tests/test_generate_manifests.py    NEW
wizard/tests/test_push_manifests.py        NEW
wizard/tests/test_dns_record.py            NEW
wizard/tests/test_argocd_sync.py           NEW
```

**Not touched:**
- `wizard/wizard/phases/_http.py`, `_git.py` — reused as-is. Phase 7 calls `_git.list_remotes()` for assertion only; phase 8 uses `_http.request_json()` for the Linode API.
- `wizard/wizard/state.py` — `PHASE_DEFINITIONS` already has `push_manifests: ("push_gitea", "push_github")` and the other three phases as substep-less. No state-schema migration in M3.
- `Dockerfile` — already has `kubectl`, `git`, `kubeseal`. The Linode API call is plain HTTPS via `requests` (no `linode-cli` dependency). No new tooling.
- `symbols/manifest.json` / `manifest.lock` — the deployment symbol already covers everything M3 renders. The LoadBalancer IP `172.232.176.47` lives in `cluster_conventions.md` (memory) and as a module-level constant in `dns_record.py`; promoting it to a `loadbalancer_ip` deployment property is a nice-to-have cleanup that does not change M3 behavior — defer to a follow-up.
- `scripts/align.py` — read only (`status` for verification, never write). No symbol changes ⇒ no `lock` regeneration.

**No `K8s/` or `argocd/` files committed at the repo root by this task doc.** Phase 6's job at *runtime* is to write those files into `/workspace`, which is where the operator's checkout is mounted. The wizard test suite renders into `tmp_path` and asserts on the strings — never to the live repo root.

---

## Phase 6 — generate_manifests

**Inputs:**
- `state.config["app_domain"]` (default `eloup.kodloki.io` per `wizard/wizard/config.py`)
- `state.config["discord_client_id"]`
- `state.config["sealed_secrets_cert_path"]` ← from phase 4
- `state.config["sealed_secrets_namespace"]` ← from phase 4
- `state.config["last_built_images"]["eloup-web"]["sha_tag"]` ← from phase 5
- `secrets["discord_client_secret"]`, `secrets["app_session_secret"]` ← only these two secrets are sealed; the four PATs (`dockerhub_pat`, `gitea_pat`, `github_pat`, `linode_pat`) stay wizard-internal and **never** reach the cluster. Module-level constant: `APP_RUNTIME_SECRET_KEYS = {"discord_client_secret", "app_session_secret"}`.
- `ctx.web_image` (override) — when set, overrides the eloup-web image lookup entirely.

**Constants** (module-level, top of `generate_manifests.py`):
- `WORKSPACE_DIR = Path("/workspace")`
- `K8S_DIR = WORKSPACE_DIR / "K8s"` (matches shine's flat layout)
- `ARGOCD_DIR = WORKSPACE_DIR / "argocd"` (separated to avoid the self-sync loop — see below)
- `NAMESPACE = "eloup"`
- `WEB_SERVICE_NAME = "eloup-web"`
- `WEB_PORT = 3000`
- `STORAGE_CLASS = "linode-block-storage-retain"`
- `STORAGE_SIZE = "5Gi"`
- `INGRESS_CLASS = "nginx"`
- `CLUSTER_ISSUER = "letsencrypt-prod"`
- `TLS_SECRET = "eloup-tls"`
- `CONFIGMAP_NAME = "eloup-web-config"`
- `SECRET_NAME = "eloup-web-secret"`
- `GITHUB_REPO_URL = "https://github.com/brandonholcombe/eloup.git"` (matches phase-3/7 constants — extracted to a shared `_constants.py` module if duplication grows beyond two callers; otherwise inline-duplicate is fine for two)
- `APP_RUNTIME_SECRET_KEYS = {"discord_client_secret", "app_session_secret"}`

### Image resolution

```
if ctx.web_image is not None:
    web_image, use_http_probe = ctx.web_image, False    # placeholder mode → TCP probe
else:
    last = state.config.get("last_built_images", {}).get("eloup-web")
    if not last:
        raise PhaseFailed("generate_manifests",
            "eloup-web image not in state.last_built_images and no --web-image override. "
            "Either build eloup-web (M4 must ship a Dockerfile.eloup-web or eloup-web/ "
            "directory) or rerun with --web-image <ref> (e.g. nginx:1.27-alpine for "
            "pipeline smoke-tests).")
    web_image = f"bholcombe/eloup-web:{last['sha_tag']}"
    use_http_probe = True
```

`use_http_probe` toggles the StatefulSet's liveness/readiness probes between `httpGet: {path: /api/health, port: 3000}` (real eloup-web) and `tcpSocket: {port: 3000}` (placeholder image — assumes the placeholder listens on 3000; the operator picks a placeholder accordingly).

### Files rendered (exact filenames)

| File | Notes |
|---|---|
| `K8s/namespace.yaml` | namespace `eloup`, labels `app=eloup` + `app.kubernetes.io/managed-by=eloup-wizard` |
| `K8s/statefulset-web.yaml` | single-replica StatefulSet (NOT Deployment — stable PVC binding for SQLite per ARCH-1). `volumeClaimTemplates` inline: `linode-block-storage-retain`, 5Gi, `ReadWriteOnce`. `securityContext` mirroring shine: pod `fsGroup: 1000`, container `runAsNonRoot: true`, `runAsUser: 1000`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`. Volume mount on `/data`. Resources: requests 256Mi/100m, limits 512Mi/500m. `envFrom: [configMapRef: eloup-web-config, secretRef: eloup-web-secret]`. Probes: see image-resolution table above. |
| `K8s/service-web.yaml` | ClusterIP, port 3000 → containerPort 3000, selector `app=eloup-web` |
| `K8s/configmap-web.yaml` | non-secret keys: `DISCORD_CLIENT_ID`, `APP_DOMAIN: https://<app_domain>`, `DATABASE_PATH: /data/eloup.sqlite` |
| `K8s/sealed-secret-web.yaml` | SealedSecret produced by piping a generated Secret manifest through `kubeseal`. See "kubeseal invocation" below. |
| `K8s/ingress.yaml` | `IngressClass: nginx`, host from `state.config.app_domain`, TLS `secretName: eloup-tls`. **Annotations copied verbatim from `shine/K8s/ingress.yaml` lines 6–27** with the host substituted in `cors-allow-origin` via the explicit `{app_domain}` template variable in `_manifests.py`. Single backend rule: `/` → `eloup-web:3000`. (No `/api` split — eloup-web is one process serving both UI and API; shine's split was because shine has separate frontend/backend services.) |
| `argocd/eloup-app.yaml` | **Outside `K8s/`** so ArgoCD never syncs it back to itself (a self-sync loop is what putting the Application in the same path it watches would cause). `metadata.name: eloup`, `metadata.namespace: argocd`, `metadata.finalizers: [resources-finalizer.argocd.argoproj.io]`, `spec.project: default`, `spec.source.{repoURL: https://github.com/brandonholcombe/eloup.git, targetRevision: HEAD, path: K8s}`, `spec.destination.{server: https://kubernetes.default.svc, namespace: eloup}`, `spec.syncPolicy.automated: {prune: true, selfHeal: true}`, `syncOptions: [CreateNamespace=true]`, `revisionHistoryLimit: 3`. Matches the captain-sonar pattern. |

### kubeseal invocation

```
src_secret = render_secret_manifest({
    "discord_client_secret": secrets["discord_client_secret"],
    "app_session_secret": secrets["app_session_secret"],
})  # → an Opaque Secret named eloup-web-secret in namespace eloup, with stringData (kubeseal preserves keys)

proc = subprocess.run(
    ["kubeseal",
     "--format=yaml",
     "--cert", state.config["sealed_secrets_cert_path"],
     f"--controller-namespace={state.config['sealed_secrets_namespace']}"],
    input=src_secret, capture_output=True, text=True, timeout=30,
)
# proc.returncode != 0 → PhaseFailed with stderr
sealed_yaml = proc.stdout
```

Notes:
- `--cert <path>` points at the file phase 4 wrote to `~/.config/eloup-wizard/sealed-secrets.crt` (host-mounted; survives container exit).
- `--controller-namespace` is the M2-stored value (`kube-system` or `sealed-secrets`); kubeseal needs it to match the cert's controller for decryption to work.
- The plaintext Secret never touches disk — it's only on `kubeseal`'s stdin. The output SealedSecret is what gets committed.
- Sealed output is deterministic per (cert, plaintext, name, namespace) for the controller's lifetime; re-running phase 6 with unchanged inputs produces an identical SealedSecret. **Caveat for the reviewer:** kubeseal randomizes nonces by default, so the output is NOT byte-identical across runs. Idempotency for git purposes (no diff on re-run) is **not** guaranteed for `K8s/sealed-secret-web.yaml`; phase 7 must therefore tolerate "no change" (skip commit) AND "only sealed-secret-web.yaml changed" (commit it). See phase 7's `git diff --cached --quiet` skip.

**Note on `pvc.yaml`:** the umbrella plan §4.1 lists a standalone `pvc.yaml` in the file set. M3 supersedes that with `volumeClaimTemplates` inline in the StatefulSet — the canonical pattern for stable per-pod PVC binding (matches Q-ARCH-1's StatefulSet decision). A standalone PVC would not be bound per-pod and would conflict with the StatefulSet's volume-management contract. The `_manifests.py` docstring records this supersession so a future reader cross-checking the umbrella plan does not look for a missing file.

### Atomicity

The phase computes everything in memory first, then writes files. Sequence:

1. Resolve `web_image` and `use_http_probe`.
2. Render every YAML string (pure functions — no I/O).
3. Run `kubeseal` (the one external dependency before disk writes). Failure here → `PhaseFailed`, no files touched.
4. `K8s_DIR.mkdir(parents=True, exist_ok=True)`, same for `ARGOCD_DIR`.
5. For each file, `_atomic_write_secure(path, content)`-style write (tempfile in same dir + `os.replace`). Per-file atomic; the full set is not transactional, but the operation is deterministic and idempotent — re-running produces the same bytes.

Mirrors the M2 phase-3 discipline of "deferred external mutation" — no working-tree files are touched until all preconditions succeed.

### Idempotency / crash recovery

- No substeps in `PHASE_DEFINITIONS["generate_manifests"]`. Phase is single-shot; on re-run, regenerates all files from current state. Safe because outputs are deterministic given the inputs (modulo kubeseal nonce — see open question #3 / resolved review note 8).
- Phase done iff every file was written. Failure leaves the state at `failed`; on `--retry-from generate_manifests` (or after fixing a broken input), the next run re-renders everything.
- On success, `state.update_config({"generate_manifests_ts": <iso8601>})` is set alongside the phase-done call. Purely informational; future tooling can detect re-runs without comparing SealedSecret bytes.

### CLI flag plumbing

Add to `cli.py`:
```python
@click.option(
    "--web-image",
    "web_image",
    type=str,
    default=None,
    help=(
        "Override the eloup-web image reference for phase 6 instead of looking it up "
        "from state.config.last_built_images. Useful for end-to-end pipeline smoke-tests "
        "before M4 ships the real Next.js app (e.g. --web-image nginx:1.27-alpine)."
    ),
)
@click.option(
    "--skip-dns",
    "skip_dns",
    is_flag=True,
    help=(
        "Skip phase 8 — operator handles the eloup.kodloki.io A-record out of band. "
        "The phase is marked done with a 'skipped by operator' note."
    ),
)
```
Thread both into `PhaseContext(...)` at the existing instantiation site. Add to `base.py`:
```python
web_image: str | None = None
skip_dns: bool = False
```
Both have dataclass defaults (per M2 reviewer's MAJOR #1 — preserves constructor compatibility for the existing test fleet).

---

## Phase 7 — push_manifests

**Inputs:** `/workspace` (operator's checkout), `state` for substep tracking, `state.config["last_built_sha"]` for the commit message.

**Step 1 — stage + commit (idempotent):**
```
git -C /workspace add K8s/ argocd/eloup-app.yaml
if git -C /workspace diff --cached --quiet:
    log "[dim]No manifest changes to commit — re-run idempotent.[/dim]"
    skip the commit
else:
    git -C /workspace commit -m "wizard: deploy eloup-web @ <sha_tag>"
```

The commit-message SHA comes from `state.config["last_built_sha"]` (always present after a successful phase 5; falls back to the literal string `unknown-sha` only if absent, which is impossible in normal flow but graceful for the `--web-image` smoke-test scenario where the operator may have skipped phase 5).

**Step 2 — push GitHub (canonical, fatal-on-fail):**
```
git -C /workspace push github main
on success → state.set_substep_status("push_manifests", "push_github", "done")
on failure → set_substep_status(..., "push_github", "failed", error=stderr)
              state.set_phase_status("push_manifests", "failed")
              raise PhaseFailed
```

Per Q-WIZ-13: GitHub push failure is fatal regardless of the Gitea state. Gitea is never attempted if GitHub fails (no point pushing a mirror of nothing).

**Step 3 — push Gitea (mirror, warning-on-fail):**
```
git -C /workspace push gitea main
on success → state.set_substep_status("push_manifests", "push_gitea", "done")
on failure → log [yellow]"Gitea mirror push failed: <stderr>. Re-run the wizard
              without flags to retry just the Gitea push (the phase will resume
              because phase status is 'failed' and push_github is still 'done').
              Do NOT use --retry-from push_manifests — it resets ALL substeps
              including push_github."[/yellow]
              set_substep_status(..., "push_gitea", "failed", error=stderr)
              do NOT raise
```

**Why not `--retry-from`:** `state.reset_from(phase_name)` (see `wizard/wizard/state.py` line 186) blows away the entire phase entry, including substep state. If the operator runs `--retry-from push_manifests` after a Gitea-only failure, `push_github` resets from `done` → `pending`, so the phase would re-attempt the GitHub push as if from scratch. That's not what the operator wants. The correct retry path is a plain re-run: the phase is `failed`, the runner re-enters it, the substep skip-check below sees `push_github = "done"` and skips step 2, then retries step 3.

**Phase done semantics (custom — per the brief):**

The phase is done when `push_github` is `done`, regardless of `push_gitea`. This deviates from the standard `state.all_substeps_done()` pattern. Implemented inline:
```python
if state.phase("push_manifests")["substeps"]["push_github"]["status"] == "done":
    state.set_phase_status("push_manifests", "done")
```

**Resume-without-retry-from semantics.** The phase MUST inspect `state.phase("push_manifests")["substeps"]["push_github"]["status"]` BEFORE running step 2 (a pre-check block at the top of `run`, not inline with the push logic). On a plain re-run after a Gitea-only failure: step 1 is no-op idempotent; step 2 is skipped because `push_github = "done"`; step 3 retries the Gitea push. On a re-run after a GitHub failure: step 2 retries (the existing commit is still in the index — push will succeed or fail again on the same root cause). On a re-run after both substeps `done` but the phase status was `failed` for some other reason: step 1 is no-op, step 2 is no-op (already done), step 3 is no-op (already done) — the phase recomputes done.

**Idempotency:**
- `git push` with no new commits → `Everything up-to-date`, exit 0. Safe to re-run.
- The commit step is gated by `git diff --cached --quiet`. Safe to re-run.
- A `push_github = "failed"` followed by a successful re-push transitions cleanly: substep flips `failed → done`, phase recomputes done.

---

## Phase 8 — dns_record

**Constants** (module-level):
- `LINODE_API_BASE = "https://api.linode.com/v4"`
- `KODLOKI_DOMAIN = "kodloki.io"`
- `ELOUP_SUBDOMAIN = "eloup"`
- `LOADBALANCER_IP = "172.232.176.47"`
- `RECORD_TTL = 3600`

**Skip path:** if `ctx.skip_dns is True`, log `[dim]DNS skipped by operator (--skip-dns) — ensure eloup.kodloki.io A-record points at 172.232.176.47 before phase 9.[/dim]`, mark phase done with `state.update_config({"dns_skipped": True})`. No API calls.

**Step 1 — find the kodloki.io domain ID:**
- Cached path: if `state.config["linode_domain_id_kodloki_io"]` exists, use it. Skip step 1's API call entirely.
- Fresh path: paginate `GET /v4/domains?page=N&page_size=100` until `data[].domain == "kodloki.io"`. Body has `pages` and `page` for the loop guard. If exhausted without a match → `PhaseFailed` with "kodloki.io domain not present in this Linode account; verify the linode_pat owns the right account, or use --skip-dns and create the A-record manually."
- Cache: `state.update_config({"linode_domain_id_kodloki_io": <id>})`.

**Step 2 — find or create the A-record:**
- `GET /v4/domains/<id>/records` (paginate as above; the kodloki.io zone has many records).
- Search `data[]` for an entry where `type == "A"` AND `name == "eloup"`.
  - Found AND `target == "172.232.176.47"` → log `[dim]DNS already correct (record id <r>).[/dim]`, mark phase done.
  - Found AND `target != "172.232.176.47"` → `PhaseFailed` with "eloup A-record exists pointing at <target>, refusing to silently overwrite. Update the record manually or delete it and re-run."
  - Not found → `POST /v4/domains/<id>/records` body `{"type": "A", "name": "eloup", "target": "172.232.176.47", "ttl_sec": 3600}`. On 200 OK, capture the new record's `id`, log `[green]Created A-record eloup → 172.232.176.47.[/green]`.

**No `dig` verification.** The original draft included a 60-second `dig +short` loop after a fresh create. Dropped per review MINOR #7: the wizard image's base (`python:3.11-slim`) does not bundle `dig` (no `dnsutils`), and the verification was already non-fatal — the Linode API 200 response is treated as authoritative. Adding `dnsutils` to the Dockerfile just for a best-effort confidence check is unjustified test/build friction. Operators who want a propagation check can run `dig` themselves; the phase logs the new record's id so the operator has a concrete handle.

**Auth:** `headers = {"Authorization": f"Bearer {secrets['linode_pat']}", "Accept": "application/json"}`. The PAT is never logged.

**Idempotency:** Step 2's GET-before-POST handles repeat invocations. Step 1's cache handles repeat invocations. Step 3 is read-only.

**No substeps** in `PHASE_DEFINITIONS["dns_record"]`. Adding them is unnecessary because every external operation (find domain, find record, create record, dig) is independently idempotent. A crash mid-step → re-run picks up where it left off based on cache + GET checks.

---

## Phase 9 — argocd_sync

**Inputs:** `secrets["github_pat"]`, the Application CRD at `/workspace/argocd/eloup-app.yaml` (written by phase 6).

**Step 1 — apply the ArgoCD repo-credential Secret (via stdin, not tmpfile):**

Render the manifest in memory (do NOT commit it — it contains the PAT):
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: eloup-repo
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
type: Opaque
stringData:
  type: git
  url: https://github.com/brandonholcombe/eloup.git
  username: brandonholcombe
  password: <secrets["github_pat"]>
```

Pipe the rendered string to `kubectl apply -f -` via subprocess stdin. Adopted per review MINOR #6: matches the existing `docker login --password-stdin` pattern in `wizard/wizard/phases/build_images.py`, keeps the PAT off disk entirely (no `mkstemp`/`fchmod` race window, no SIGKILL-leaves-file risk), and removes a `finally`-cleanup obligation. The `_kubectl.py` helper module exposes `apply_stdin(manifest: str)` for this and any future caller.

`stringData` (not `data`) so kubectl base64-encodes for us. Apply is idempotent: the existing Secret (if any) is updated with the new PAT.

**Step 2 — apply the Application CRD from phase 6:**

```
kubectl apply -f /workspace/argocd/eloup-app.yaml
```

Idempotent — `apply` updates an existing Application named `eloup` in `argocd` namespace. The CRD has `metadata.finalizers: [resources-finalizer.argocd.argoproj.io]` so manual `kubectl delete application eloup -n argocd` will properly cascade.

**Step 3 — poll Synced/Healthy (with not-yet-visible guard):**

```
deadline = time.monotonic() + 600  # 10 min
last_sync, last_health, last_conditions = None, None, []
with Live(panel) as live:
    while time.monotonic() < deadline:
        proc = subprocess.run(["kubectl", "-n", "argocd", "get", "application", "eloup", "-o", "json"], ...)
        if proc.returncode != 0:
            live.update(render_panel("not-yet-visible", "—"))
            time.sleep(10)
            continue
        try:
            body = json.loads(proc.stdout)
        except json.JSONDecodeError:
            live.update(render_panel("not-yet-visible", "—"))
            time.sleep(10)
            continue
        last_sync = body.get("status", {}).get("sync", {}).get("status")          # Synced | OutOfSync | Unknown | None
        last_health = body.get("status", {}).get("health", {}).get("status")      # Healthy | Progressing | Degraded | Suspended | Missing | Unknown | None
        last_conditions = body.get("status", {}).get("conditions") or []
        live.update(render_panel(last_sync or "—", last_health or "—"))
        if last_sync == "Synced" and last_health == "Healthy":
            break
        time.sleep(10)
    else:
        # Timeout
        log [red]f"Application did not reach Synced/Healthy in 10 min."
        log f"Last sync: {last_sync}, last health: {last_health}."
        log f"Conditions: {last_conditions}"
        log "Debug: kubectl describe application eloup -n argocd"
        raise PhaseFailed("argocd_sync", "timeout waiting for Synced/Healthy")
```

**Not-yet-visible guard.** Adopted per review MAJOR #1: between `kubectl apply` returning and ArgoCD's controller writing the resource's `status` sub-resource (or even the resource itself becoming visible to the API), `kubectl get` may exit non-zero with empty stdout. A bare `json.loads("")` would raise `JSONDecodeError`, surfacing an unhandled exception instead of looping. The two-tier guard (returncode check, then JSON-parse try/except) treats both modes as "not yet visible — keep polling." Only the deadline escalates.

`Rich.live.Live` updates a single Rich `Panel` in place each tick — no terminal scroll spam.

**On success:**
```
state.update_config({"eloup_url": f"https://{state.config['app_domain']}"})
state.set_phase_status("argocd_sync", "done")
console.print("[green]Wizard complete — eloup is live at https://eloup.kodloki.io[/green]")
```

The literal URL in the success message comes from `state.config["app_domain"]` (defaults to `eloup.kodloki.io`).

**Idempotency:**
- Apply Secret — `apply` updates in place.
- Apply Application — `apply` updates in place.
- Poll — read-only.
- `--retry-from argocd_sync` re-runs all three. Safe.

**No substeps** for the same reason as phase 8 — every step is independently idempotent and there's no expensive intermediate state worth checkpointing.

---

## Test approach

All tests offline by default. Mark live tests with `@pytest.mark.live`. Use `responses` for Linode HTTP, `unittest.mock.patch` for `subprocess.run` (matching the M2 `FakeKubectl` style in `test_cluster_bootstrap.py`).

### `test_generate_manifests.py`

- **All-files-written happy path** (with `last_built_images["eloup-web"]`): mock `subprocess.run` for `kubeseal` to return a deterministic `SealedSecret` YAML on stdout; assert all 7 files exist with expected names; parse each YAML and assert key fields (image ref, namespace, ingress host, storage class).
- **--web-image override path**: set `ctx.web_image = "nginx:1.27-alpine"`, no `last_built_images`; assert StatefulSet has `image: nginx:1.27-alpine` and probes are TCP on port 3000 (NOT httpGet `/api/health`).
- **No image, no override → PhaseFailed**: `last_built_images = {}`, `ctx.web_image = None`; assert exception message names `--web-image`.
- **kubeseal failure → PhaseFailed**: subprocess returns nonzero; assert no files written (the failure happens before disk writes).
- **Idempotent re-run**: write once, then re-run; same files, same content (kubeseal mocked to return same bytes). Assert file mtimes are updated (proves we re-wrote) but contents match. Real-world kubeseal nonces will differ across runs; the test mocks kubeseal so the determinism check is on our renderer, not kubeseal.
- **Ingress host substitution**: change `state.config["app_domain"]` to a non-default value, assert ingress.yaml's host AND `cors-allow-origin` annotation both reflect it.
- **Sealed Secret only contains the two runtime keys, NOT the four PATs**: build the input plaintext from `secrets` dict that includes all six keys; assert the `kubeseal` stdin contained only `discord_client_secret` and `app_session_secret`.
- **Ingress `cors-allow-origin` substitution**: set `state.config["app_domain"] = "test-eloup.example"`; assert the rendered ingress.yaml contains `cors-allow-origin: "https://test-eloup.example"` and NOT the literal string `shine.kodloki.io` anywhere.
- **Image-key contract assertion**: verify the phase reads `state.config["last_built_images"]["eloup-web"]["sha_tag"]` exactly (not `"eloup_web"` or `"web"`). A test that presets the wrong key and asserts a clean `PhaseFailed` (rather than KeyError) covers a future M2 refactor regression.

### `test_push_manifests.py`

- **Both pushes succeed**: mock `subprocess.run` for `git add/commit/push`; assert both substeps `done`, phase `done`.
- **GitHub fails → PhaseFailed, Gitea not attempted**: `git push github` returns nonzero; assert phase `failed`, `push_github = failed`, `push_gitea` still `pending`, AND that `git push gitea` was never called.
- **GitHub succeeds, Gitea fails → phase done with warning**: assert `push_github = done`, `push_gitea = failed` (with stderr captured), phase `done`. Assert console output contains the warning text.
- **`test_retry_gitea_only_without_retry_from`**: preset `push_github = done, push_gitea = failed` directly in the state file (simulating the prior run's outcome). The phase resumes via plain re-entry (NOT `--retry-from`, which would reset the substep). Assert step 2 (GitHub push) is not invoked at all, step 3 (Gitea push) is invoked, second-run state has both substeps `done`. Test docstring explains why `--retry-from` is not used (would reset `push_github`).
- **No diff to commit → skip commit, push still attempted**: mock `git diff --cached --quiet` to exit 0 (no diff); assert no `git commit` call, but `git push` still runs (for the case where a previous run committed but failed mid-push).

### `test_dns_record.py`

- **Domain found, record absent → POST creates record**: `responses` registers paginated `GET /v4/domains` returning kodloki.io with id 12345, `GET /v4/domains/12345/records` returning records without an `eloup` A-record, `POST /v4/domains/12345/records` returning 200 with new id. Assert the POST body shape exactly. Assert `state.config["linode_domain_id_kodloki_io"] == 12345`.
- **Domain found, record correct → no POST**: pre-existing `eloup` A-record with target `172.232.176.47`. Assert no POST call, phase done, log contains "already correct".
- **Domain found, record with WRONG target → PhaseFailed**: target is `1.2.3.4`. Assert no POST call, phase fails with a message naming both targets.
- **Domain absent → PhaseFailed**: pages exhausted without a match. Assert phase fails with a message naming `kodloki.io`.
- **`--skip-dns` → no API calls**: assert `state.config["dns_skipped"] is True`, phase done, no `responses` calls registered fired.
- **Cached domain id → skip the GET /v4/domains paginate**: preset `state.config["linode_domain_id_kodloki_io"] = 12345`; assert only the records endpoint is hit.

### `test_argocd_sync.py`

- **Happy path — synced/healthy on first poll**: mock `subprocess.run` for both `kubectl apply` calls and the `kubectl get application` poll; the get returns `{"status": {"sync": {"status": "Synced"}, "health": {"status": "Healthy"}}}`. Assert phase done, `state.config["eloup_url"] == "https://eloup.kodloki.io"`.
- **Becomes healthy after N polls**: get returns `Progressing` 3 times then `Healthy`; assert poll loop exits cleanly. Speed-up by patching `time.sleep` to a no-op.
- **Polling timeout → PhaseFailed**: get always returns `Progressing`; patch `time.monotonic` so the loop's deadline is reached after a few iterations. Assert error message includes the last-known sync+health and references `kubectl describe application eloup`.
- **Repo Secret applied via stdin, not tmpfile**: assert the `kubectl apply -f -` subprocess was invoked with the manifest as `input=` (subprocess kwarg), and that no temporary file was created. Also assert the PAT does not appear in `argv` and only appears once in the `input` kwarg (as the `password:` field of `stringData`, never repeated).
- **Application CRD apply uses the file phase 6 wrote**: set `ARGOCD_DIR / "eloup-app.yaml"` content; assert `kubectl apply -f <that exact path>` was invoked.
- **Application not yet visible to the API server**: first 2 `kubectl get application` calls return exit 1 with empty stdout (resource not yet visible); third call returns valid JSON with `status` absent (resource visible, status sub-resource not yet written by ArgoCD); fourth returns Synced/Healthy. Assert the loop continues without raising and reports done at the end. Also covers the `JSONDecodeError` and `proc.returncode != 0` branches.
- **Polling timeout → PhaseFailed**: get always returns valid JSON with `Progressing/Progressing`; patch `time.monotonic` so the loop's deadline is reached after a few iterations. Assert error message includes the last-known sync+health and references `kubectl describe application eloup`.

### Existing tests

All existing 52 tests must continue to pass. The two new flag additions (`--web-image`, `--skip-dns`) get dataclass defaults so no existing `PhaseContext(...)` constructor needs updating.

Add two CLI-threading tests to `test_cli.py`:
- `--web-image foo:bar` → `ctx.web_image == "foo:bar"` reaches the phase.
- `--skip-dns` → `ctx.skip_dns is True` reaches the phase.

(Mirroring the `--install-sealed-secrets` thread-test the M2 reviewer recommended.)

---

## Verification before reporting done

1. `python3 scripts/align.py check` exits 0. (No symbol changes ⇒ no `lock` regeneration needed; verify alignment didn't drift via an unrelated edit.)
2. `cd wizard && python3 -m pytest -q` passes — existing 52 + new (~28 estimated).
3. `python3 -m ruff check wizard/` clean.
4. `python3 -m ruff format --check wizard/` clean.
5. `docker build -t eloup-wizard-m3-test .` succeeds.
6. `docker run --rm eloup-wizard-m3-test --help` lists `--web-image` and `--skip-dns`.
7. **End-to-end live run** (gated on operator supplying real PATs):
   - Pre-req: phases 1–5 already run successfully against tow-c1.
   - Run with `--web-image nginx:1.27-alpine` (M4 has not shipped, eloup-web image absent).
     - Phase 6 renders 6 `K8s/*.yaml` + `argocd/eloup-app.yaml` (no standalone `pvc.yaml` — superseded by `volumeClaimTemplates` inline in the StatefulSet); sealed-secret-web.yaml decrypts back to the right plaintext via `kubeseal --recovery-unseal --recovery-private-key <controller-key>` (manual operator check).
     - Phase 7 commits both directories and pushes to GitHub + Gitea.
     - Phase 8 creates the A-record (or detects-and-skips).
     - Phase 9 applies the Secret + Application, polls Synced/Healthy (nginx pod will become healthy on TCP probe).
   - Manual final check: `https://eloup.kodloki.io` returns the nginx welcome page over HTTPS with a valid Let's Encrypt cert.

If real PATs are not available for live verification: report which phases were exercised purely against mocks vs unit-tested-only, and what specifically remains to be smoke-tested before declaring M3 production-ready.

---

## Commits

Per the M2 reviewer's NIT #7, **commit 1 is task doc only** — the implementer does not bundle their own review report. Four commits expected:

1. **`docs: M3 — wizard phases 6-9 task doc`** — this file only.
2. **`docs: M3 — reviewer report for phases 6-9`** — written by the independent reviewer (different agent) at `Agents/Review-reports/m3-wizard-phases-6-9-review.md`. The reviewer commits this; the implementer does not. (If the reviewer agent runs in the same session as a downstream tool, the implementer can commit on their behalf, but the in-document `## Reviewer:` field stays distinct from `## Author:` per the gate's self-review rule.)
3. **`feat: wizard phases 6-7 — render manifests + dual-remote push`** — phase 6 + phase 7 code, helpers (`_manifests.py`, `_kubectl.py`), tests, CLI flag for `--web-image`, `PhaseContext.web_image`. Updates `runner.py` to wire the two new phases.
4. **`feat: wizard phases 8-9 — Linode DNS + ArgoCD application register`** — phase 8 + phase 9 code, tests, CLI flag for `--skip-dns`, `PhaseContext.skip_dns`. Updates `runner.py` to wire the two new phases. Deletes `wizard/wizard/phases/stubs.py` (no remaining users after this commit).

Each commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## M3→M4 hand-off contract

After M3 ships, **M4 does not need to touch the wizard at all.** The contract M4 inherits:

- **Phase 6 reads `state.config["last_built_images"]["eloup-web"]["sha_tag"]`** to fill the StatefulSet image. M4's responsibility is solely:
  1. Drop a `Dockerfile.eloup-web` at the repo root, OR an `eloup-web/` directory containing a `Dockerfile`. Phase 5's `_resolve_eloup_web_spec()` will pick it up automatically (the logic already exists from M2).
  2. The image must listen on port 3000 and serve `GET /api/health` returning 200 once ready (phase 6's StatefulSet probe targets this when no `--web-image` override is set).
  3. The image consumes these env vars (provided via `envFrom` from the ConfigMap + SealedSecret):
     - `DISCORD_CLIENT_ID` (configmap)
     - `APP_DOMAIN` (configmap; `https://eloup.kodloki.io`)
     - `DATABASE_PATH` (configmap; `/data/eloup.sqlite` — write to this path; the PVC is mounted on `/data`)
     - `DISCORD_CLIENT_SECRET` (sealed secret)
     - `APP_SESSION_SECRET` (sealed secret)
- **Re-running the wizard with no flag changes deploys the real app.** Specifically: rerun phase 5 (rebuilds with the new eloup-web context), then `--retry-from generate_manifests` to re-render phase 6 with the real image SHA, then phases 7→9 push and sync.
- **Adding new env vars in M4 requires** updating `APP_RUNTIME_SECRET_KEYS` (for new secrets) and the configmap-renderer (for new non-secrets) in `generate_manifests.py`. There is no other config-collection plumbing to change for app-runtime values; the four PATs (DockerHub/Gitea/GitHub/Linode) are wizard-internal and don't reach the cluster.
- **Adding a second container or service in M4** (e.g. a worker, a websocket process) is a phase-6 manifest change — not a wizard-architecture change.

This contract is intentionally narrow: it lets M4 ship an app without re-deriving the deploy pipeline.

---

## Resolved review notes

The independent review at `Agents/Review-reports/m3-wizard-phases-6-9-review.md` produced the following changes to this plan. Each item names the review finding it addresses and the section above that was amended.

1. **[MAJOR #1] Phase 9 poll loop crashes on absent `status` block / non-JSON stdout.** Phase 9 step 3 is now wrapped in a two-tier guard: `proc.returncode != 0` → log "not yet visible" + continue; `json.JSONDecodeError` on `proc.stdout` → same. Only the 10-min deadline escalates to `PhaseFailed`. The `last_sync`/`last_health`/`last_conditions` accumulators are initialized to `None`/`None`/`[]` so the timeout error path always has values to log, even if every poll fell into the not-yet-visible branch. Test coverage extended with an explicit "first 2 calls return exit 1, third returns valid JSON without status, fourth returns Synced/Healthy" case.

2. **[MAJOR #2] Ingress annotation line-reference is wrong + template variable is unnamed.** The phase 6 file table now cites `lines 6–27` (correct range — the annotations block runs from `annotations:` on line 6 through `cors-allow-credentials: "true"` on line 27). The substitution variable in `_manifests.py`'s ingress template will be the explicit `{app_domain}` placeholder, not an inline f-string substitution. New test asserts the rendered `cors-allow-origin` value reflects a non-default `state.config["app_domain"]` and never contains the literal string `shine.kodloki.io`.

3. **[MAJOR #3] `--retry-from push_manifests` resets substep state.** Phase 7's warning log on Gitea-only failure now tells operators to **re-run the wizard without flags** (NOT `--retry-from push_manifests`, which `state.reset_from()` would use to wipe `push_github` from `done` to `pending`). The phase's own resume logic (substep skip-check at the top of `run`) handles the Gitea-only retry correctly when called via plain re-entry. The corresponding test is renamed to `test_retry_gitea_only_without_retry_from` with a docstring explaining the constraint.

4. **[MAJOR #4] `pvc.yaml` mismatch between umbrella plan and M3 plan.** A note in phase 6 (and the verification step) records that the standalone `pvc.yaml` listed in `project-review-and-plan.md` §4.1 is superseded by `volumeClaimTemplates` inline in the StatefulSet — the canonical pattern for stable per-pod PVC binding under Q-ARCH-1. The `_manifests.py` module-level docstring repeats this so a future reader doesn't look for a missing file.

5. **[MINOR #5] M2→M3 contract key names verified.** No code change; the reviewer confirmed `state.config["sealed_secrets_namespace"]`, `state.config["sealed_secrets_cert_path"]`, and `state.config["last_built_images"]["eloup-web"]["sha_tag"]` all match the actual M2 implementation. A new test in `test_generate_manifests.py` asserts the phase reads the exact key path so a future M2 refactor doesn't silently break phase 6.

6. **[MINOR #6] Phase 9 step 1: stdin over tmpfile.** The repo-credential Secret is now applied via `kubectl apply -f -` with the manifest piped to subprocess stdin (consistent with `docker login --password-stdin` in `wizard/wizard/phases/build_images.py`). No `mkstemp`/`fchmod`/`unlink` dance, no SIGKILL-leaves-file risk, no `finally` obligation. The `_kubectl.py` helper module exposes `apply_stdin(manifest: str)` for this and any future caller. Test updated to assert no tmpfile is created and the PAT is not in `argv`.

7. **[MINOR #7] `dig` is not in `python:3.11-slim`.** Phase 8 step 3 (the 60-second `dig +short` verification loop) is dropped entirely. The Linode API success is already authoritative and the original step was best-effort/non-fatal. Skipping `dig` removes an external dependency, eliminates a Dockerfile change, and removes a test fixture. Operators who want a propagation check run `dig` themselves; the phase logs the new record's id as a concrete handle.

8. **[MINOR #8] Sealed-secret nonce non-determinism.** Position deferred per reviewer's recommendation. Adding a hash side-car is overengineered for M3. As a one-liner concession, phase 6's success path now writes `state.update_config({"generate_manifests_ts": _now()})` so future tooling can detect re-runs without comparing SealedSecret bytes. No behavioral change.

9. **[NIT #9] `last_built_sha` fallback chain.** Phase 7's commit-message SHA now falls through `state.config["last_built_sha"]` → `state.config["last_built_images"]["eloup-wizard"]["sha_tag"]` → literal `"unknown-sha"`. The wizard image is built every phase-5 invocation (even when eloup-web is skipped), so the second tier is virtually always populated. The literal `"unknown-sha"` final fallback is preserved for the truly-skipped phase-5 case (operator running `--retry-from push_manifests` against a wholly fresh state).

10. **[NIT #10] `test_push_manifests.py` retry-test naming.** Test name and docstring updated per the review (see resolved note #3 above).

### Open questions the reviewer did not weigh in on

These remain as recorded design choices, not blockers:

- **Single backend rule in `K8s/ingress.yaml`** — kept (eloup-web is one Next.js process; shine's `/api` split was due to a separate backend service). Prometheus scraping can be reserved later via a separate Service + ServiceMonitor without an ingress change.
- **`loadbalancer_ip` symbol property** — deferred; M3's symbol diff stays at zero. Will follow up only if the constant grows a second consumer.
- **`--web-image` + probe shape coupling** — kept; the placeholder-image case implies a TCP probe (real eloup-web is the only thing serving `/api/health`). A separate `--web-probe` flag would be operator overhead with no real upside.
