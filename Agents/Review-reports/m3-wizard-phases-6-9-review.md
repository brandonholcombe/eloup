# Review: m3-wizard-phases-6-9.md

## Reviewer: claude-sonnet-4-6-m3-reviewer
## Date: 2026-05-10
## Verdict: APPROVE WITH NOTES

## Summary

The M3 task doc in `m3-wizard-phases-6-9.md` is the strongest per-milestone plan yet: phase 6 atomicity discipline is correctly specified (kubeseal before disk writes), the `argocd/eloup-app.yaml` self-sync separation is clearly motivated, and the custom `push_github=done` semantics for phase 7 are thought-through. The weakest section is phase 9's polling loop, which has a latent misread of the Application's initial-absent state that will produce a misleading `PhaseFailed` on first-run deployments. There is also a gap in `test_push_manifests.py` that the retry semantics plan describes but the test coverage does not fully exercise, and a concrete mismatch between the plan's ingress-annotation claim ("copied verbatim from lines 7–26") and what the actual shine ingress file contains. None of these are architectural blockers, but four findings are marked [MAJOR] because they will surface in implementation if not addressed first.

---

## Issues found

**1. [MAJOR] Phase 9 polling crashes on absent `status` block — no initial-reconcile guard**

The poll loop reads:
```python
sync = body.get("status", {}).get("sync", {}).get("status")
health = body.get("status", {}).get("health", {}).get("status")
```
Both return `None` when the Application was just applied and ArgoCD has not completed its first reconcile. The loop body then falls through to the `time.sleep(10)` call, which is correct. **However,** if `kubectl get application eloup -n argocd -o json` itself returns exit-code 1 (the resource does not yet exist in the API — possible in the gap between `kubectl apply` completing and ArgoCD's operator first writing the status sub-resource), `proc.returncode != 0` and `json.loads(proc.stdout)` raises `json.JSONDecodeError` (stdout is empty). The plan does not handle this case: a bare `json.loads(proc.stdout)` will throw, surfacing an unhandled exception rather than looping cleanly.

More subtly: after a successful `kubectl apply -f argocd/eloup-app.yaml`, the resource exists but `status` is absent until ArgoCD's first reconcile. This is the "initially absent" case the brief asks the reviewer to weigh in on. The plan's `.get("status", {})` chain does handle `None` status gracefully — **but only if `proc.stdout` is valid JSON.** The failure mode is a failed `kubectl get` or an empty response, not a missing `status` key.

Suggested fix: Wrap the `kubectl get` call in a try/except that handles both `json.JSONDecodeError` and non-zero returncode by logging `[dim]Application not yet visible to API server — retrying...[/dim]` and continuing the loop. Do not raise on the first few failed gets; only escalate after the deadline.

---

**2. [MAJOR] Ingress annotation line-reference is wrong and the annotation set needs adjustment**

The plan states: "Annotations copied verbatim from `shine/K8s/ingress.yaml` lines 7–26 with the host substituted in `cors-allow-origin`."

Reading the actual file at `/Users/brandonholcombe/kodloki/shine/K8s/ingress.yaml`: the annotations block runs from line 6 (`annotations:`) through line 27 (`cors-allow-credentials: "true"`). More importantly, the plan claims to copy "verbatim" but specifies a **single `/` backend rule** because "shine's split was because shine has separate frontend/backend services." The annotation block itself is fine to copy — the CORS `cors-allow-origin` substitution is correct. However, the plan omits one annotation that shine does NOT have but eloup may want: `nginx.ingress.kubernetes.io/proxy-buffer-size` for Next.js's large OAuth redirect headers. This is a [NIT]-level concern but worth raising here because it is a known source of 502s behind nginx for Next.js OAuth flows.

Separately: the plan's `_manifests.py` template module must verify that `cors-allow-origin` references the `app_domain` from state, not a hardcoded `shine.kodloki.io`. The plan says "with the host substituted" but does not confirm the template parameter name — a typo here produces a silently wrong CORS header.

Suggested fix: Correct the line-reference comment in `_manifests.py` to `lines 6–27` (minor) and explicitly name the template variable (`{app_domain}`) in the ingress template so a code reviewer can verify the substitution. Add a test assertion that checks the rendered `cors-allow-origin` value when `state.config["app_domain"]` is set to a non-default value (the plan lists this test case but does not name the specific annotation field to assert on).

---

**3. [MAJOR] Phase 7 retry semantics: `--retry-from push_manifests` after `push_github=done` skips GitHub correctly, but the state-read path is underspecified**

The plan describes retry: "if `push_github = 'done'`, skip step 2 entirely and go straight to step 3 (Gitea retry)." To implement this, phase 7 must inspect `state.phase("push_manifests")["substeps"]["push_github"]["status"]` **before** running step 2. This means the phase needs a pre-check block at the top — not inline with the push logic. The plan implies this but does not write it out explicitly enough to prevent an implementer from only checking the substep status in the success/failure handler.

More critically: if the operator runs `--retry-from push_manifests` and the previous run left `push_github=done, push_gitea=failed`, the runner calls `state.reset_from("push_manifests")` (see `wizard/wizard/state.py` line 186) **which resets ALL substeps to `pending`**. The plan's retry semantics depend on reading the substep status as it was left by the prior run — but `--retry-from` blows away exactly that state. This is a design conflict: the plan says the retry skips GitHub if `push_github=done`, but `--retry-from` sets `push_github=pending` before the phase runs. The operator's only correct path to retry Gitea-only would be re-running the wizard **without** `--retry-from`, relying on the phase's own "all-done" check. The plan does not document this constraint, and the log message says "Re-run with `--retry-from push_manifests` to retry just the Gitea push" — which is wrong advice given the `reset_from` semantics.

Suggested fix: Either (a) document in the plan that `--retry-from push_manifests` resets substep state and the correct Gitea-only retry is to re-run the wizard without any flag (the phase will resume at push_manifests because `phase_status=failed` and will read `push_github=done`), or (b) change the substep skip check to rely on `push_github` substep status only when the phase's own `status` is `failed` (not `pending`), using the prior run's state. The warning log message must be corrected to avoid operator confusion.

---

**4. [MAJOR] Phase 6 file count inconsistency: plan says 7 files, table has 6 `K8s/` files + 1 `argocd/` file = 7 total, but the verification step says "6 K8s/*.yaml + argocd/eloup-app.yaml"**

The end-to-end verification in §"Verification" step 7 says: "Phase 6 renders **6** K8s/*.yaml + argocd/eloup-app.yaml." Counting the files table: `namespace.yaml`, `statefulset-web.yaml`, `service-web.yaml`, `configmap-web.yaml`, `sealed-secret-web.yaml`, `ingress.yaml` = 6 `K8s/` files plus `argocd/eloup-app.yaml` = 7 total. This is consistent. However, the plan's phase 6 "Files rendered" table omits a `pvc.yaml` that the umbrella plan §4.1 specifically lists ("pvc.yaml (sqlite)"). Instead the plan uses `volumeClaimTemplates` inline in the StatefulSet, which is the correct choice for a StatefulSet (VCTs are the canonical way to provision storage for StatefulSet pods — an external PVC would not be bound per-pod). But the umbrella plan's file list is now inconsistent with the implementation plan, and the verification text in §4.1 may mislead an operator checking for `pvc.yaml`.

Suggested fix: Add a one-line note in the M3 plan explaining that the standalone `pvc.yaml` listed in the umbrella plan is superseded by the StatefulSet's `volumeClaimTemplates` (which binds a PVC per pod automatically). This aligns M3's manifest list with Q-ARCH-1's StatefulSet decision and prevents operator confusion during live verification.

---

**5. [MINOR] `state.config["sealed_secrets_namespace"]` key name mismatch — plan reads wrong key**

Phase 6 reads `state.config["sealed_secrets_namespace"]` for the `--controller-namespace` flag. Looking at the actual M2 implementation in `cluster_bootstrap.py` line 317:
```python
ctx.state.update_config({
    "sealed_secrets_namespace": controller_ns,
    "sealed_secrets_cert_path": str(cert_path),
    "sealed_secrets_version": SEALED_SECRETS_VERSION,
})
```
The key is `"sealed_secrets_namespace"` — this matches the plan. No mismatch. (Confirming for the implementer: the contract is correct; this issue is resolved.) However, `state.config["last_built_images"]["eloup-web"]["sha_tag"]` is read in phase 6 — confirming from `build_images.py` lines 188–193, `last_built` is keyed by `spec.component`, which is `ELOUP_WEB_COMPONENT = "eloup-web"`. The key and field names match. Both M2→M3 contracts are correctly specified.

Suggested fix: None needed on the key names. But add an explicit assert in `test_generate_manifests.py` that validates the exact key path `state.config["last_built_images"]["eloup-web"]["sha_tag"]` is consumed (not `"eloup_web"` or `"web"`) so a future refactor of build_images.py doesn't silently break phase 6.

---

**6. [MINOR] Phase 9 step 1 open question — take a position: prefer stdin over tmpfile**

The plan defers the tmpfile-vs-stdin question to the reviewer. Position: **use stdin** (`kubectl apply -f -` with the manifest string piped). Reasons: (1) the PAT never touches disk at all, even temporarily — `os.fchmod(fd, 0600)` before writing is good hygiene but a race window still exists between `mkstemp` and `fchmod`; (2) the `finally: os.unlink(tmpfile)` cleanup works in normal operation but will leave the file on disk if the process is killed with SIGKILL (not SIGTERM) — an edge case but real; (3) subprocess stdin is the established pattern for secrets in this codebase (`docker login --password-stdin` in `build_images.py`). The stdin approach is consistent and marginally safer. The `_kubectl.py` helper planned for M3 should expose an `apply_stdin(manifest: str)` function that the phase calls.

Suggested fix: Change step 1 to use `kubectl apply -f -` with the manifest string as stdin input. Update `test_argocd_sync.py`'s "no PAT in argv" test to also assert the PAT does not appear in the subprocess `input` kwarg (it should appear only as the `password` field of the stringData block, base64-encoded by kubectl — not as a bare string that could be logged).

---

**7. [MINOR] Phase 8 `dig` invocation is an undocumented external dependency**

Phase 8 step 3 calls `dig +short eloup.kodloki.io @ns1.linode.com`. The wizard Dockerfile's tool list (per M2's Dockerfile changes) includes `kubectl`, `argocd`, `docker`, `kubeseal`. `dig` is not listed. On `python:3.11-slim` (the base image), `dig` is not present by default — it requires `dnsutils` or `bind-utils`.

Suggested fix: Either add `dnsutils` to the Dockerfile (one `apt-get install` line), or skip the `dig` verification step entirely and rely solely on the Linode API success as authoritative (which the plan already treats as sufficient — step 3 is best-effort and non-fatal). Skipping `dig` is the cleaner choice: it eliminates an external dependency, makes the verification purely offline-capable, and removes a test complexity (the plan already mocks `dig` in `test_dns_record.py`, which signals it's test friction).

---

**8. [MINOR] Open question #3 (sealed-secret nonces) — take a position: defer is correct, but add a state flag**

The plan correctly identifies that kubeseal's non-deterministic nonces mean `sealed-secret-web.yaml` will diff on every re-run of phase 6 even if the inputs are unchanged. The plan's response is: phase 7's `git diff --cached --quiet` guard will either skip the commit (no diff) or commit it (nonce changed). This is correct behavior. The "hash side-car" alternative is indeed overengineered for M3. However, the plan should add a `state.update_config({"generate_manifests_ts": ...})` timestamp when phase 6 completes, so that a future cleanup tool can detect "I ran generate_manifests twice within the same session" without comparing SealedSecret bytes. This does not block M3 but is a one-liner worth folding in.

Suggested fix: Add `state.update_config({"generate_manifests_ts": _now()})` to phase 6's success path, alongside the phase-done call. No behavioral change; purely informational for future tooling.

---

**9. [NIT] Open question #6 (`last_built_sha` fallback to `unknown-sha`) — take a position: keep the graceful fallback**

The plan asks whether `unknown-sha` should become a `PhaseFailed`. Position: keep the graceful fallback. The `--web-image` smoke-test path exists specifically to allow M3 end-to-end verification before M4 lands a real eloup-web build; requiring phase 5 to have run (and thus a real `last_built_sha`) defeats the purpose. The fallback commit message `wizard: deploy eloup-web @ unknown-sha` is admittedly ugly but clearly communicates the intent. The wizard-image SHA is always present in `last_built_images["eloup-wizard"]` even when eloup-web was skipped; the plan could use that as a fallback rather than `unknown-sha`. Cleaner: `wizard-sha-only:<sha>` where `<sha>` is the wizard image's SHA, communicating that the commit was from a wizard run that skipped eloup-web build.

Suggested fix: Use `state.config.get("last_built_sha") or state.config.get("last_built_images", {}).get("eloup-wizard", {}).get("sha_tag", "unknown-sha")` as the fallback chain. One line; no behavior change for normal flow.

---

**10. [NIT] `test_push_manifests.py` is missing the `push_github=done` substep pre-set retry case**

The plan describes this test: "Re-run after Gitea-only failure: preset `push_github=done, push_gitea=failed`; re-run skips the GitHub push (or runs it as a no-op `Everything up-to-date`), retries Gitea." This test case is listed but is undermined by the [MAJOR] #3 finding: `--retry-from` resets substep state, so the preset state would be blown away if the operator uses that flag. The test case should simulate a wizard re-run **without** `--retry-from` — i.e., the phase is called directly with a preset `push_github=done, push_gitea=failed` state in the state file, and the phase's own resume logic handles the skip. Make this explicit in the test and in the phase's docstring.

Suggested fix: Rename the test to `test_retry_gitea_only_without_retry_from` and add a comment explaining why `--retry-from` is NOT used in this test path.

---

## Coverage check

Requirements from the M3 brief (umbrella plan §4.1 phases 6–9) and locked decisions:

- [x] **Q-WIZ-4 Sealed Secrets** — SealedSecret only for `discord_client_secret` + `app_session_secret`; four PATs excluded via `APP_RUNTIME_SECRET_KEYS`. Phase 6 spec is correct.
- [x] **Q-WIZ-12 GitHub canonical** — phase 7 treats GitHub push as fatal, Gitea as non-fatal warning. Correct.
- [x] **Q-WIZ-13 mirror failures non-fatal** — `push_gitea` failure logs warning, does not raise, does not block phase-done. Correct.
- [x] **Q-ARCH-1 single-replica StatefulSet** — `volumeClaimTemplates` inline, `replicas: 1`, `linode-block-storage-retain`, `5Gi`, `ReadWriteOnce`. Correct.
- [x] **`argocd/eloup-app.yaml` outside `K8s/`** — explicitly separated to avoid self-sync loop. Phase 7 stages both paths. Correct.
- [x] **Phase 7 dual-remote substep tracking** — `push_gitea` + `push_github` match existing `PHASE_DEFINITIONS` in `state.py` line 22.
- [x] **Phase 8 Linode DNS idempotency** — GET-before-POST, wrong-target detection raises rather than silently overwrites. Correct.
- [x] **Phase 8 `--skip-dns` flag** — marks phase done with `dns_skipped: True` config key. Consistent with brief.
- [x] **Phase 9 repo Secret not committed** — rendered in memory, applied via kubectl, never written to the gitops tree. Correct.
- [x] **Phase 9 10-minute poll deadline** — `deadline = time.monotonic() + 600`. Correct.
- [x] **PhaseContext additions use dataclass defaults** — `web_image: str | None = None`, `skip_dns: bool = False`. Preserves all 52 existing tests.
- [x] **No symbol changes in M3** — plan confirms no `manifest.json` edits; `align.py check` exits 0 (verified).
- [x] **Test: SealedSecret only contains runtime keys** — `test_generate_manifests.py` lists this as an explicit case.
- [x] **Test: GitHub fails AND Gitea never called** — `test_push_manifests.py` includes this case.
- [x] **Test: tmpfile/stdin for repo Secret is deleted on failure** — `test_argocd_sync.py` covers the `finally` cleanup.
- [ ] **Phase 9 initial-absent Application state** — `kubectl get` on a freshly-applied Application may return non-JSON stdout (exit code 1, empty stdout). The plan's loop does not guard this. See [MAJOR] #1.
- [ ] **`dig` binary not in wizard Dockerfile** — phase 8 step 3 calls `dig` which is absent from `python:3.11-slim`. See [MINOR] #7.
- [ ] **`--retry-from push_manifests` + substep state conflict** — documented in the log message but behaviorally wrong. See [MAJOR] #3.
- [ ] **Standalone `pvc.yaml` vs `volumeClaimTemplates`** — umbrella plan lists `pvc.yaml`; M3 plan supersedes this silently. See [MAJOR] #4.

---

## Strengths worth keeping

- **Phase 6 atomicity discipline is correctly ordered.** Compute-then-kubeseal-then-write is the right sequence: a kubeseal failure before any disk writes means the working tree is never left in a partial state. The `_atomic_write_secure`-style per-file write (tempfile + `os.replace`) matches the state.py pattern. Don't weaken this.

- **`APP_RUNTIME_SECRET_KEYS` as a module-level constant is the right design.** Making the set of sealed keys explicit and named (rather than derived from the secrets dict at runtime) means a future M4 developer adding a new secret must make a conscious edit to include it in the SealedSecret. The constant is the right gatekeeping mechanism.

- **Phase 7's `git diff --cached --quiet` guard is exactly right.** A re-run of phase 6 that produces identical manifests (or a nonce-changed SealedSecret) must not create an empty or redundant git commit. The guard handles both the no-change and changed-SealedSecret cases correctly. Preserve this.

- **Phase 8 wrong-target detection raises rather than silently overwrites.** The plan explicitly raises `PhaseFailed` when an existing `eloup` A-record points at a different IP. This prevents silent misconfiguration on clusters where the DNS record was set up manually before the wizard runs. The conservative choice here is the right one.

- **Phase 9 Rich `Live` panel design avoids terminal scroll spam.** A single in-place panel for the poll loop is the correct UX for a 10-minute wait. Don't replace this with print-per-tick logging.

- **The M3→M4 hand-off contract is explicit and narrow.** The three M4 responsibilities (Dockerfile, `/api/health` endpoint, env var consumption) are precisely listed. M4 does not need to re-derive the deploy pipeline. Keep this section as-is.

---

## Recommended follow-ups for the implementer

1. **Guard `kubectl get application` for non-JSON stdout in phase 9's poll loop.** Wrap the JSON parse in try/except and treat `json.JSONDecodeError` or non-zero returncode as a "not yet visible" condition — log a dim message and continue the loop. Only escalate after the deadline.

2. **Correct the `--retry-from push_manifests` guidance in phase 7's warning log.** The correct Gitea-only retry is re-running the wizard WITHOUT `--retry-from` (which would reset substep state). Update the yellow warning message to say "Re-run the wizard without flags to retry just the Gitea push." Add a test comment explaining why the retry test does not use `--retry-from`.

3. **Decide on stdin vs tmpfile for phase 9 step 1 and go with stdin.** The `_kubectl.py` helper should expose `apply_stdin(manifest: str)` consistent with `docker login --password-stdin`. Update the test to assert the PAT is not in subprocess args.

4. **Add `dnsutils` to the Dockerfile for `dig`, OR drop phase 8 step 3 entirely.** Dropping the dig check is the cleaner choice: Linode API success is already treated as authoritative; the best-effort verification adds test friction without changing behavior.

5. **Add a note in the M3 plan and `_manifests.py` docstring** that `pvc.yaml` from the umbrella plan is superseded by `volumeClaimTemplates` inline in the StatefulSet, and that the ArgoCD path is `K8s/` (not `K8s/*.yaml` + `pvc.yaml`).

6. **Explicitly name the `{app_domain}` template variable in `_manifests.py`'s ingress template** and add a test assertion that `cors-allow-origin` contains the domain, not the hardcoded `shine.kodloki.io`, when a non-default `app_domain` is used in test setup.
