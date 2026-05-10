# M3 — Wizard phases 6–9: manifests, push, DNS, ArgoCD register

## Author: claude-opus-4.7-m3-implementer
## Status: Not Started

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
| `K8s/ingress.yaml` | `IngressClass: nginx`, host from `state.config.app_domain`, TLS `secretName: eloup-tls`. **Annotations copied verbatim from `shine/K8s/ingress.yaml` lines 7–26** with the host substituted in `cors-allow-origin`. Single backend rule: `/` → `eloup-web:3000`. (No `/api` split — eloup-web is one process serving both UI and API; shine's split was because shine has separate frontend/backend services.) |
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

### Atomicity

The phase computes everything in memory first, then writes files. Sequence:

1. Resolve `web_image` and `use_http_probe`.
2. Render every YAML string (pure functions — no I/O).
3. Run `kubeseal` (the one external dependency before disk writes). Failure here → `PhaseFailed`, no files touched.
4. `K8s_DIR.mkdir(parents=True, exist_ok=True)`, same for `ARGOCD_DIR`.
5. For each file, `_atomic_write_secure(path, content)`-style write (tempfile in same dir + `os.replace`). Per-file atomic; the full set is not transactional, but the operation is deterministic and idempotent — re-running produces the same bytes.

Mirrors the M2 phase-3 discipline of "deferred external mutation" — no working-tree files are touched until all preconditions succeed.

### Idempotency / crash recovery

- No substeps in `PHASE_DEFINITIONS["generate_manifests"]`. Phase is single-shot; on re-run, regenerates all files from current state. Safe because outputs are deterministic given the inputs.
- Phase done iff every file was written. Failure leaves the state at `failed`; on `--retry-from generate_manifests` (or after fixing a broken input), the next run re-renders everything.

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
on failure → log [yellow]"Gitea mirror push failed: <stderr>. Re-run with
              --retry-from push_manifests to retry just the Gitea push."[/yellow]
              set_substep_status(..., "push_gitea", "failed", error=stderr)
              do NOT raise
```

**Phase done semantics (custom — per the brief):**

The phase is done when `push_github` is `done`, regardless of `push_gitea`. This deviates from the standard `state.all_substeps_done()` pattern. Implemented inline:
```python
if state.phase("push_manifests")["substeps"]["push_github"]["status"] == "done":
    state.set_phase_status("push_manifests", "done")
```

The `--retry-from push_manifests` invocation re-enters the phase. Step 1 (stage+commit) is no-op idempotent. Step 2 (GitHub push) is checked first: if `push_github = "done"`, skip step 2 entirely and go straight to step 3 (Gitea retry). If `push_github = "failed"`, retry step 2 (which will likely succeed — the same diff the operator pushed before is still in the index, but will be a no-op push with `Everything up-to-date` and exit 0). This means the substep-level granularity drives the retry — phase-level "done" doesn't gate.

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

**Step 3 — best-effort verify** (only when we actually created the record):
- Loop up to 60s, every 5s: `dig +short eloup.kodloki.io @ns1.linode.com`.
  - Output contains `172.232.176.47` → log `[green]DNS resolved.[/green]`, done.
  - Loop exhausts → log `[yellow]DNS created but resolver lag observed — continuing. Linode may take longer to propagate.[/yellow]`, **mark phase done anyway** (the Linode API success is authoritative; dig is just confidence).

**Auth:** `headers = {"Authorization": f"Bearer {secrets['linode_pat']}", "Accept": "application/json"}`. The PAT is never logged.

**Idempotency:** Step 2's GET-before-POST handles repeat invocations. Step 1's cache handles repeat invocations. Step 3 is read-only.

**No substeps** in `PHASE_DEFINITIONS["dns_record"]`. Adding them is unnecessary because every external operation (find domain, find record, create record, dig) is independently idempotent. A crash mid-step → re-run picks up where it left off based on cache + GET checks.

---

## Phase 9 — argocd_sync

**Inputs:** `secrets["github_pat"]`, the Application CRD at `/workspace/argocd/eloup-app.yaml` (written by phase 6).

**Step 1 — apply the ArgoCD repo-credential Secret:**

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

Write to `Path(tempfile.mkstemp(suffix=".yaml"))` with `os.fchmod(fd, 0o600)` before the file content is written. `kubectl apply -f <tmpfile>`. `os.unlink(tmpfile)` in `finally` so the PAT-bearing file does NOT linger. (Could also use `kubectl apply -f -` with stdin to avoid disk entirely; the brief calls for a tmpfile, so I'll use a tmpfile but with strict 0600 mode and a guaranteed `finally` cleanup. If the reviewer prefers stdin, I'll switch — the difference is one subprocess call shape.)

`stringData` (not `data`) so kubectl base64-encodes for us. Apply is idempotent: the existing Secret (if any) is updated with the new PAT.

**Step 2 — apply the Application CRD from phase 6:**

```
kubectl apply -f /workspace/argocd/eloup-app.yaml
```

Idempotent — `apply` updates an existing Application named `eloup` in `argocd` namespace. The CRD has `metadata.finalizers: [resources-finalizer.argocd.argoproj.io]` so manual `kubectl delete application eloup -n argocd` will properly cascade.

**Step 3 — poll Synced/Healthy:**

```
deadline = time.monotonic() + 600  # 10 min
with Live(table_panel) as live:
    while time.monotonic() < deadline:
        proc = subprocess.run(["kubectl", "-n", "argocd", "get", "application", "eloup", "-o", "json"], ...)
        body = json.loads(proc.stdout)
        sync = body.get("status", {}).get("sync", {}).get("status")          # Synced | OutOfSync | Unknown
        health = body.get("status", {}).get("health", {}).get("status")      # Healthy | Progressing | Degraded | Suspended | Missing | Unknown
        live.update(render_panel(sync, health))
        if sync == "Synced" and health == "Healthy":
            break
        time.sleep(10)
    else:
        # Timeout
        last_conditions = body.get("status", {}).get("conditions", [])
        log [red]"Application did not reach Synced/Healthy in 10 min."
        log "Last sync: <sync>, last health: <health>."
        log "Conditions: <last_conditions>"
        log "Debug: kubectl describe application eloup -n argocd"
        raise PhaseFailed("argocd_sync", "timeout waiting for Synced/Healthy")
```

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

### `test_push_manifests.py`

- **Both pushes succeed**: mock `subprocess.run` for `git add/commit/push`; assert both substeps `done`, phase `done`.
- **GitHub fails → PhaseFailed, Gitea not attempted**: `git push github` returns nonzero; assert phase `failed`, `push_github = failed`, `push_gitea` still `pending`, AND that `git push gitea` was never called.
- **GitHub succeeds, Gitea fails → phase done with warning**: assert `push_github = done`, `push_gitea = failed` (with stderr captured), phase `done`. Assert console output contains the warning text.
- **Re-run after Gitea-only failure**: preset `push_github = done, push_gitea = failed`; re-run skips the GitHub push (or runs it as a no-op `Everything up-to-date`), retries Gitea. Assert second-run state is both `done`.
- **No diff to commit → skip commit, push still attempted**: mock `git diff --cached --quiet` to exit 0 (no diff); assert no `git commit` call, but `git push` still runs (for the case where a previous run committed but failed mid-push).

### `test_dns_record.py`

- **Domain found, record absent → POST creates record**: `responses` registers paginated `GET /v4/domains` returning kodloki.io with id 12345, `GET /v4/domains/12345/records` returning records without an `eloup` A-record, `POST /v4/domains/12345/records` returning 200 with new id. Assert the POST body shape exactly. Assert `state.config["linode_domain_id_kodloki_io"] == 12345`.
- **Domain found, record correct → no POST**: pre-existing `eloup` A-record with target `172.232.176.47`. Assert no POST call, phase done, log contains "already correct".
- **Domain found, record with WRONG target → PhaseFailed**: target is `1.2.3.4`. Assert no POST call, phase fails with a message naming both targets.
- **Domain absent → PhaseFailed**: pages exhausted without a match. Assert phase fails with a message naming `kodloki.io`.
- **`--skip-dns` → no API calls**: assert `state.config["dns_skipped"] is True`, phase done, no `responses` calls registered fired.
- **Cached domain id → skip the GET /v4/domains paginate**: preset `state.config["linode_domain_id_kodloki_io"] = 12345`; assert only the records endpoint is hit.
- **dig verification timeout is non-fatal**: when the create-record path fires, mock `subprocess.run("dig", ...)` to return empty output; assert phase done with a yellow warning logged.

### `test_argocd_sync.py`

- **Happy path — synced/healthy on first poll**: mock `subprocess.run` for both `kubectl apply` calls and the `kubectl get application` poll; the get returns `{"status": {"sync": {"status": "Synced"}, "health": {"status": "Healthy"}}}`. Assert phase done, `state.config["eloup_url"] == "https://eloup.kodloki.io"`.
- **Becomes healthy after N polls**: get returns `Progressing` 3 times then `Healthy`; assert poll loop exits cleanly. Speed-up by patching `time.sleep` to a no-op.
- **Polling timeout → PhaseFailed**: get always returns `Progressing`; patch `time.monotonic` so the loop's deadline is reached after a few iterations. Assert error message includes the last-known sync+health and references `kubectl describe application eloup`.
- **Repo Secret tmpfile is deleted in `finally`**: patch `tempfile.mkstemp` to return a path under `tmp_path`; even when the second apply fails, assert the tmpfile no longer exists after the call.
- **Application CRD apply uses the file phase 6 wrote**: set `ARGOCD_DIR / "eloup-app.yaml"` content; assert `kubectl apply -f <that exact path>` was invoked.
- **No PAT in argv**: assert no `kubectl` invocation's argv includes the literal PAT string. (Defensive — the PAT goes via stdin/file, never argv.)

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
     - Phase 6 renders 6 K8s/*.yaml + argocd/eloup-app.yaml; sealed-secret-web.yaml decrypts back to the right plaintext via `kubeseal --recovery-unseal --recovery-private-key <controller-key>` (manual operator check).
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

## Open questions / notes for the reviewer

These are calls I'd like the reviewer to either ratify or push back on:

1. **Single backend rule in `K8s/ingress.yaml`** — eloup-web serves both UI and API from one Next.js process, so I'm collapsing shine's `/api` + `/metrics` + `/` three-way split into a single `/` rule. If the reviewer thinks Prometheus scraping should be reserved (a `/metrics` rule today), I can add it — the eloup-web app M4 might want to expose metrics on a separate port via the Service, in which case the ingress doesn't need a `/metrics` rule.

2. **Phase 9 step 1 — tmpfile vs stdin for the repo Secret.** I'm planning a tmpfile (mode 0600, `finally` cleanup) per the brief's literal text. If the reviewer prefers `kubectl apply -f - < manifest_string` to keep the PAT off disk entirely, I'll switch — the difference is small and stdin is marginally safer.

3. **Sealed Secret nonces are non-deterministic across runs.** I document this as a phase-7 idempotency caveat ("on re-run, only `sealed-secret-web.yaml` may diff"). The alternative is to skip re-rendering the SealedSecret if `K8s/sealed-secret-web.yaml` already exists and the plaintext inputs haven't changed (would need a hash side-car) — feels overengineered for M3. Defer to a follow-up if the operator finds the per-run drift annoying.

4. **`loadbalancer_ip` symbol property.** Adding `loadbalancer_ip: "172.232.176.47"` to the deployment symbol would consolidate the constant currently duplicated between `cluster_conventions.md` (memory) and `dns_record.py` (module constant). It's a one-line `manifest.json` change + a `lock` regen. I'm deferring it to keep M3's symbol diff at zero (review surface stays focused on phase code), but if the reviewer prefers it in M3 I'll fold it in.

5. **`--web-image` + probe shape coupling.** The brief specifies "TCP probe when `--web-image` is set, httpGet `/api/health` otherwise." This couples a CLI flag to a manifest-render decision. An alternative is a separate `--web-probe={tcp,http}` flag, but the coupling matches operator intent (placeholder image ⇒ TCP) and avoids flag explosion. Holding the coupling unless the reviewer flags it.

6. **Phase 7 commit-message SHA when no eloup-web was built.** If the operator ran `--web-image nginx:1.27-alpine` and skipped phase 5 entirely, `state.config["last_built_sha"]` may be absent. My fallback is the literal string `unknown-sha` in the commit message. The reviewer may prefer requiring phase 5 to have run at least once (even if eloup-web was skipped, the wizard-image build sets `last_built_sha`) — in which case absence becomes a `PhaseFailed` instead. Defaulting to graceful for now since the smoke-test path exists exactly to bypass M4 dependencies.
