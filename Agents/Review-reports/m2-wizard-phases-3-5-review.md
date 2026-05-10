# Review: m2-wizard-phases-3-5.md

## Reviewer: claude-sonnet-4-6-m2-reviewer
## Date: 2026-05-09
## Verdict: APPROVE WITH NOTES

## Summary

The M2 task doc in `m2-wizard-phases-3-5.md` is thorough, correctly aligned with the umbrella plan's §4.1 contract, and properly addresses both M0-review follow-ups that were called out as relevant to phases 3-5 (URL-encoding the dotted Gitea owner and per-substep state granularity). The phase 3 plan is the strongest section — idempotency semantics, collision detection, and the deferred remote-mutation discipline are all correctly specified. Phases 4 and 5 are sound but carry a handful of gaps that the implementer must resolve before shipping: the `--install-sealed-secrets` flag's surface area is understated relative to the actual `cli.py`/`base.py` changes required, the DockerHub skip-check uses an unofficial API, and phase 5's eloup-web "skip if absent" stance should be explicit policy rather than an open question left to the reviewer. None of these are correctness blockers for M2 itself, but two should be resolved before implementation begins.

---

## Issues found

**1. [MAJOR] `--install-sealed-secrets` flag surface area is larger than the plan acknowledges**

The plan says: "New CLI flag `--install-sealed-secrets`. When set AND the controller is missing, apply the pinned manifest." The plan's "Files I'll change" list shows `wizard/wizard/cli.py` and `wizard/wizard/phases/base.py`.

Reading the actual files:

- `cli.py` uses `@click.option(...)` decorators on `main()` and passes them as keyword arguments to `PhaseContext`. Every new flag must be added to both the `@click.option` decorator block AND the `PhaseContext(...)` instantiation call at line 83.
- `base.py`'s `PhaseContext` is a `@dataclass`. Adding `install_sealed_secrets: bool` to it is a one-liner, but this is a **breaking change to the dataclass constructor** — every test that instantiates `PhaseContext` directly (including any existing M1 tests) must be updated to supply the new field or given a `field(default=False)` default.
- `runner.py` does not pass `install_sealed_secrets` anywhere currently; the field must flow from `ctx` into `ClusterBootstrapPhase.run(ctx)`. That call is already through `ctx`, so no runner change is required — but the plan should say this explicitly to avoid a misread.

The plan's "Files I'll change" table says it changes `cli.py` and `base.py` but says nothing about the impact on existing tests or whether `install_sealed_secrets` should default to `False` (so existing `PhaseContext` construction in tests doesn't break). This is a real gap: if the implementer adds a non-default field to the dataclass, all 25 existing tests that construct `PhaseContext` will fail.

**Suggested fix:** Add `install_sealed_secrets: bool = False` (with a dataclass default) to `PhaseContext`, not `install_sealed_secrets: bool`. Document this choice in the task doc. Alternatively, update the plan's "Files I'll change" table to call out "update all existing tests that construct `PhaseContext` directly."

---

**2. [MINOR] DockerHub Hub API (`hub.docker.com/v2`) is not the OCI distribution API and may 404 for valid images**

Phase 5 specifies: `GET https://hub.docker.com/v2/repositories/bholcombe/{component}/tags/{sha}` to check if an image is already pushed.

This is the DockerHub catalog/browse API, not the OCI distribution spec API (`registry-1.docker.io/v2/...`). The two behave differently:

- `hub.docker.com/v2/repositories/{user}/{repo}/tags/{tag}` requires the tag to exist and be indexed by DockerHub's catalog service, which has a replication lag after a push. An image pushed seconds ago may 404 even though it exists. This means a wizard re-run immediately after a partial push could incorrectly re-trigger a buildx call.
- The plan's own "open questions" section notes: "it's not the official registry API; should we fall back to `registry-1.docker.io` (token-auth dance) if the Hub API ever rate-limits?" This hedging is appropriate but the risk is broader than rate-limiting — it's also correctness under lag and the unauthenticated nature of the endpoint (public images only; if the DockerHub namespace is ever made private this check silently breaks).

The plan notes the Hub API is "simpler for M2; revisit only if operational issue." This is an acceptable deferral, but the implementer should be explicit: the skip-if-pushed check is a **performance optimization**, not a correctness gate. A redundant re-push of an existing image is safe (Docker registry is idempotent on pushes of the same digest). The implementer should document this in a code comment so a future reader doesn't assume the skip is required for correctness.

**Suggested fix:** Add a comment in `build_images.py` stating that the Hub API skip is an optimization only — the `buildx --push` call is safe to repeat and will no-op at the layer level if the image is unchanged. Do not gate correctness on the Hub API check.

---

**3. [MINOR] Phase 4 Sealed Secrets namespace detection is underspecified for the cert-fetch step**

Phase 4 detects the Sealed Secrets controller in "either `kube-system` or `sealed-secrets` namespace." The cert-cache step then runs:

```
kubeseal --fetch-cert --controller-namespace=<ns> > <state_dir>/sealed-secrets.crt
```

The variable `<ns>` must be bound from the detection step — whichever namespace the controller was found in. The plan does not explicitly say the detection result is stored and threaded into the cert-fetch invocation. A careless implementer could hardcode `kube-system` or pick the wrong namespace if the controller ends up in `sealed-secrets`.

Additionally: the plan does not specify what `<state_dir>` resolves to in the cert-fetch path. Looking at `wizard/wizard/paths.py` would clarify this, but the task doc should make it explicit: `state_dir = ctx.paths.state_dir` (the same directory that holds `state.json`), so the cert lands at `~/.config/eloup-wizard/sealed-secrets.crt` on the host.

**Suggested fix:** Explicitly state in the phase 4 spec that (a) the detected namespace is stored as a local variable and reused in the cert-fetch command, and (b) `state_dir` in the cert-fetch path resolves to `ctx.paths.state_dir`.

---

**4. [MINOR] Phase 5 eloup-web "skip if absent" should be settled policy, not an open question**

The plan's "Open questions" section asks: "Should phase 5's eloup-web 'skip if absent' be stricter (e.g., gated on a `--build-eloup-web` flag) or is the directory-presence check enough?"

Leaving this as an open question to the reviewer is a process problem: the implementer wrote the plan and opened a question that only the reviewer can resolve, but the reviewer is not the decision-maker here. The user is. This question should either have been answered by the implementer with a bold default (following the pattern of the umbrella plan) or escalated to the user before the task doc was finalized.

The directory-presence check is the correct default for M2: the eloup-web app does not exist yet (the task doc confirms this — "skip cleanly if absent"). A `--build-eloup-web` flag makes sense only when eloup-web exists and the operator might want to opt out of rebuilding it. For M2, the flag would always be absent and the skip would always fire — making it pure noise.

**Suggested fix:** The implementer should adopt the bold default (directory-presence check, no flag) and document the rationale in the plan rather than leaving it to the reviewer. This review resolves the question: use directory-presence for M2. A `--build-eloup-web` flag can be added in M4 when the app exists.

---

**5. [MINOR] Symbol update adds properties to `deployment` but should verify no new symbol is needed**

The plan adds `secret_management: "sealed_secrets"` and `sealed_secrets_version: "v0.27.1"` to the `deployment` symbol. Looking at `symbols/manifest.json`, the `deployment` symbol currently has no secret-management properties. Adding them there is reasonable since Sealed Secrets is a cluster-level deployment concern, not a per-app secret model.

However, the `deployment` symbol's existing structure groups its properties into infrastructure expectations and cluster facts. Secret management straddles both: it's a cluster requirement (controller must be installed) and a wizard behavior (kubeseal is used during phase 6). There is no `secrets` symbol in the manifest — the `betting` symbol references `escrow_at_placement` and `currency` but there is no separate secrets-management symbol.

This is acceptable for M2 as described. The concern is minor: future reviewers may find `sealed_secrets_version` in the `deployment` symbol and wonder if it belongs in an `infrastructure` or `secrets` symbol. The plan's mechanical step — run `python3 scripts/align.py lock` — is the only action needed, which is correct.

**Suggested fix:** Add a one-line comment in the plan clarifying why `secret_management` goes in `deployment` rather than a new symbol (answer: Sealed Secrets is a cluster infrastructure concern, and creating a new symbol would require defining interlocks that don't yet add value for a single-property addition).

---

**6. [NIT] `docker logout` is called after "all images processed" but the plan's failure path is ambiguous**

Phase 5 says: "`docker logout` to clear `~/.docker/config.json` of the wizard's session" and "Auth handling: … `docker logout` is in a `finally` block so a failed build still clears the credential."

The "no substeps" design means any image build failure raises `PhaseFailed` and the `finally` runs. This is correct. However, the plan says `docker login` is called "once at the start of the phase" — if the DockerHub skip-check for the wizard image returns 200 (skip) and the eloup-web image is absent (skip), `docker login` was never called but `docker logout` would still run in `finally`. Running `docker logout` when no `docker login` was performed is harmless but wasteful and could produce a confusing log line.

**Suggested fix:** Track a `logged_in` boolean at the phase level and only call `docker logout` in `finally` if `logged_in is True`. Minor, but makes the logs cleaner.

---

**7. [NIT] Commit message for commit 1 says "this task doc plus the reviewer's report" — the reviewer writes their report separately**

Commit 1 is: `docs: M2 — wizard phases 3-5 task doc` with the note "this task doc plus the reviewer's report, no code."

The review gate design requires the reviewer's report to be written by a different agent, likely in a different session. Including the reviewer's report in the same commit as the task doc implies they're written simultaneously. In practice the implementer should commit only the task doc in commit 1; the reviewer commits the review report; then the implementer begins commits 2 and 3.

**Suggested fix:** Split commit 1 into: (1a) task doc only (`docs: M2 — wizard phases 3-5 task doc`), (1b) review report added after independent review (`docs: M2 — reviewer report for phases 3-5`). The implementer cannot include their own reviewer's report in their commit.

---

## Coverage check

Requirements from the M2 brief and umbrella plan §4.1 vs plan coverage:

- [x] **Phase 3: URL-encode Gitea owner** — `quote(GITEA_OWNER, safe='')` in the GET path. M0 review follow-up #7 is honored.
- [x] **Phase 3: per-substep state granularity** — `PHASE_DEFINITIONS` already has `provision_repos: ("gitea_repo", "github_repo")`; plan uses `set_substep_status` and `all_substeps_done` correctly. M0 review follow-up #5 is honored.
- [x] **Phase 3: idempotent 409/422 handling** — 409 on Gitea → existence check; 422 with exact error message check on GitHub → existence check.
- [x] **Phase 3: fail-loud on remote collision** — "Hard fail (don't silently overwrite) if a local remote name collides with a different URL."
- [x] **Phase 3: `origin → github` rename** — "if `origin` exists and points at the GitHub URL, `git remote rename origin github`" is correctly specified.
- [x] **Phase 3: idempotency on rerun** — "On rerun with `gitea_repo=done, github_repo=pending`: skip the Gitea call block entirely, run only GitHub."
- [x] **Phase 3: crash mid-substep resume** — per-substep tracking enables correct resume.
- [x] **Phase 4: detect-order sensible** — ordered by likelihood of being present (ArgoCD, cert-manager, ingress-nginx, StorageClass, Sealed Secrets). Correct.
- [x] **Phase 4: each missing component → exact `kubectl apply -f` command** — specified per component in the detect table. Actionable.
- [x] **Phase 4: `--install-sealed-secrets` flag pinned version** — `SEALED_SECRETS_VERSION = "v0.27.1"` module-level constant.
- [x] **Phase 4: cert-cache hand-off to M3** — `state.update_config({"sealed_secrets_cert_path": ...})` documented as the M2→M3 contract.
- [x] **Phase 4: no installation of ArgoCD/cert-manager/ingress-nginx/StorageClass** — explicitly: "No installation of these four."
- [x] **Phase 5: dirty-SHA handling** — `<sha>-dirty` suffix, Rich warning, proceed.
- [x] **Phase 5: skip-if-pushed on correct URL** — per-image check on the correct component name. _(See Issue #2 re: Hub API vs OCI API.)_
- [x] **Phase 5: `state.config.last_built_images` for M3** — documented as M2→M3 contract for manifest gen.
- [x] **Phase 5: eloup-web skip if absent** — documented; resolved as directory-presence check by this review (Issue #4).
- [x] **DockerHub PAT: `--password-stdin`, not argv** — correctly specified.
- [x] **DockerHub PAT: `docker logout` in `finally`** — correctly specified.
- [x] **Symbol update: `secret_management` and `sealed_secrets_version` in `deployment`** — correct symbol, correct mechanical step (`align.py lock`).
- [x] **Test: idempotency rerun (phase 3)** — "Idempotent: pre-existing repos (Gitea 409, GitHub 422 ...)" test case covers this.
- [x] **Test: crash mid-substep resume (phase 3)** — "Re-run after Gitea succeeded but GitHub failed" covers this.
- [x] **Test: detect-and-skip semantics (phase 4)** — "Each component missing in turn → phase fails" and "All five components present → phase done" cover this.
- [x] **Test: skip-if-pushed (phase 5)** — "Wizard image already pushed (200) → buildx is not invoked" covers this.
- [ ] **Test: live-flag plumbing** — `responses` and `pytest-httpserver` mocking covers offline cases, but there is no test that exercises the `--install-sealed-secrets` flag's effect on `PhaseContext.install_sealed_secrets` threading from CLI → phase. A unit test for this flag-to-context wiring is missing. _(See also Issue #1.)_

---

## Strengths worth keeping

- **Phase 3 deferred remote mutation is correctly designed.** The plan defers `git remote add/rename` until both API substeps succeed. This is the right call — partial API success should not mutate the working tree. A crash after Gitea but before GitHub never creates a dangling git remote that the operator has to clean up manually.

- **Phase 3 GitHub 422 check is exact.** The plan specifies `errors[].message == "name already exists on this account"` — not a substring match, not a status-code-only check. This prevents silently swallowing unrelated 422s (e.g., invalid repo name) as false positives.

- **Phase 4 failure table design is operator-friendly.** Collecting all missing components before raising (rather than failing on the first missing one) lets the operator fix everything in one pass. The `kubectl apply -f` remediation lines in the error output make the fix action clear without requiring the operator to look up docs.

- **The M2→M3 hand-off contracts are explicit.** `state.config.sealed_secrets_cert_path` and `state.config.last_built_images` are both named and their consumers documented. This is the right way to design cross-milestone boundaries — M3 can be written without re-reading phase 4 and 5 implementation details.

- **`docker login --password-stdin` with `docker logout` in `finally` is the correct pattern.** The PAT never appears in `argv`, never in the process list, and the credential is cleaned up even on failure. This is the right posture for a wizard that runs interactively.

- **Offline-by-default test design is correct.** `@pytest.mark.live` gates real-network calls; the 25 existing tests plus new mocked tests stay runnable in CI without credentials. This matches the M1 test architecture.

---

## Recommended follow-ups for the implementer

1. **Add `install_sealed_secrets: bool = False` as a dataclass default in `PhaseContext`.** Do not add a non-default field; that breaks the 25 existing tests. Then verify no existing test constructs `PhaseContext` with positional args that would silently skip the new field.

2. **Add a test for `--install-sealed-secrets` flag threading.** The test should invoke `cli.main` (via `click.testing.CliRunner`) with `--install-sealed-secrets` and assert that `ctx.install_sealed_secrets is True` reaches `ClusterBootstrapPhase.run`. This closes the gap in the coverage check above.

3. **Document the Hub API skip as a performance optimization, not a correctness gate.** Add a comment in `build_images.py` (or the plan's phase 5 spec) that makes this explicit. The skip is an optimization; the buildx push is safe to repeat.

4. **Pin the detected Sealed Secrets namespace.** In `cluster_bootstrap.py`, store the detected namespace (whichever of `kube-system`/`sealed-secrets` the controller was found in) in a local variable and pass it explicitly to both the rollout-status command and the `kubeseal --fetch-cert` call. Do not re-detect the namespace in the cert-fetch step.

5. **Resolve the eloup-web build policy before implementation.** The directory-presence check is the correct M2 policy (this review resolves the open question). Remove the open question from the task doc; replace with: "eloup-web is skipped if the build context path is absent — no flag needed for M2."

6. **Fix the commit 1 description.** The implementer commits only the task doc in commit 1. The reviewer's report is committed by the reviewer. Update the commit plan to reflect this so the implementer does not accidentally self-include the review report.

7. **Verify `ctx.paths.state_dir` is the correct base for the cert path.** Before writing `kubeseal --fetch-cert > <state_dir>/sealed-secrets.crt`, confirm that `ctx.paths.state_dir` resolves to the host-mounted directory (`~/.config/eloup-wizard`) — not an ephemeral path inside the container. Reading `wizard/wizard/paths.py` is the right check; the cert must survive container exit.
