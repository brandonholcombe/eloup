# H1 — Review report

## Reviewer: claude-sonnet-4-6-h1-reviewer

## Verdict: APPROVED-WITH-CHANGES

Task reviewed: `h1-admin-bootstrap-and-nav.md` (commit d6c8f2b).

## Summary

The H1 hotfix task is well-reasoned, tightly scoped, and correctly diagnoses both gaps that surfaced in the first real prod login. The wizard contract change (omit-vs-empty-string) is architecturally correct given `lib/env.ts`'s `z.string().optional()` schema, and the UI choice of option (b) — Admin section on `/profile` — is right for a mobile-first PWA where `/games` is a low-frequency operator surface. The bootstrap promotion no-op logic in `maybePromote` is correctly analyzed: the `player.role !== 'global_admin'` guard on line 69 of `players.ts` genuinely short-circuits for an already-promoted player.

Two issues require resolution before implementation begins. First, `config.py`'s `load_yaml_config` currently rejects unknown YAML keys with a hard error (`ConfigFileError: unknown keys`). Adding `bootstrap_admin_discord_id` to `wizard.yaml` without also adding it to `ALL_FIELDS` (which requires adding it to `CONFIG_FIELDS` or a new optional bucket) will cause `wizard --config wizard.yaml` to blow up on any existing operator-host YAML that carries the new field before the code ships — or, conversely, on any new YAML loaded against old code. The task's description of adding the field to `CONFIG_FIELDS` implies this is understood, but the interaction with `load_yaml_config`'s `unknown` guard is not explicitly called out and must be verified during implementation. Second, the vitest test path `tests/unit/profile-admin-section.test.ts` is in the correct directory and `.ts` extension is correct, but the helper extraction approach implicitly creates a new file `components/ProfileAdminSection.tsx` (or adds to `lib/permissions.ts`) — the task should name the helper file explicitly rather than leaving it as "(or inline in `lib/permissions.ts`)" to avoid scope ambiguity between the two commits.

## Findings

1. **Independent Review Rule — PASS**

   `## Author: claude-opus-4.7-h1-implementer` vs `## Reviewer: claude-sonnet-4-6-h1-reviewer`. These are distinct agent identities. The review gate's author/reviewer mismatch requirement is satisfied. See the section at the bottom of this report.

2. **Scope discipline — PASS**

   Bundling the two issues is appropriate. Both share the framing "make global_admin actually usable end-to-end" and both are tiny, non-architectural patches that would be friction-generating if split across separate review cycles. The out-of-scope list is explicit and correct: no role-management UI, no demote flows, no BottomNav 5th-slot rework, no wizard image rebuild orchestration script. The one boundary judgment worth noting is the note to M3's task doc ("I will append a short note to `Agents/TODO/Active/m3-wizard-phases-6-9.md`"): appending to a Completed task doc is unusual but the gate allows it since M3 is Complete and the doc lives under `Agents/`, which is never gated. The rationale (contract surface documentation) is valid.

3. **Wizard contract change correctness — PASS with OBSERVATION**

   Omitting the ConfigMap key when the field is absent or empty is the correct choice. `lib/env.ts` line 9 declares `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID: z.string().optional()`, which parses `undefined` (absent key in `process.env`) as `undefined` and `"" ` as `""` (a non-undefined string). Had the wizard emitted `: ""`, `env()` would return `""` for the field, and `bootstrapPlayer` in `lib/db/players.ts` line 52 would evaluate `bootstrapAdminDiscordId && ...` as falsy (empty string is falsy in JS) — so it would accidentally work — but it is still the wrong semantic: `env.ts` would report the var as present-but-empty, not absent. Omitting the key is cleaner and the `z.string().optional()` schema confirms that absent maps to `undefined` in the validated `Env` type.

   OBSERVATION: The `None` propagation through `prompts._from_yaml_only` depends on the fact that `load_yaml_config` in `config.py` lines 67-69 rejects unknown keys. If `bootstrap_admin_discord_id` is added to `wizard.yaml.template` but an operator runs with an old wizard image (before H1), `load_yaml_config` will throw `ConfigFileError: unknown keys: ['bootstrap_admin_discord_id']`. This backward-incompatibility window is short (the field only appears in the operator's YAML after the operator deliberately adds it following the template comment), but the task should acknowledge it. It is not blocking since the field ships as optional-with-comment and the operator would only add it when upgrading to the H1 wizard image, but the implementer should verify the `CONFIG_FIELDS` addition correctly unblocks `load_yaml_config`'s unknown-key guard.

4. **Test plan adequacy — CONCERN (MINOR)**

   The two phase-level pytest cases (present + absent ConfigMap key) adequately catch the regression. The optional suggestion for a pure `render_configmap` unit test is good; the existing test pattern already has pure-function tests (`test_render_plain_secret_rejects_pats` etc.), and a `render_configmap(bootstrap_admin_discord_id="x")` vs `render_configmap()` pair would lock the omit-vs-empty behavior at the tightest boundary. The task marks it "optional" — this reviewer agrees it is not blocking but recommends including it since it costs three lines of test code.

   The identified gap around empty-string normalization (YAML `bootstrap_admin_discord_id: ""` should flow to omitted key, not `""`) is real and is currently only tested indirectly through the phase path. A direct `test_render_configmap_empty_string_omits_key` on the pure function would make this airtight. Not blocking, but worth adding.

   The vitest helper-extraction approach is reasonable given the `tests/**/*.test.ts`-only vitest config and the fact that Next.js App Router server components cannot be rendered in a pure Vitest environment without a full RSC test harness. The existing `tests/integration/bootstrap-admin.test.ts` confirms this project's style: direct module imports, no JSX rendering, ephemeral SQLite. The helper function approach is consistent with that style. The `tests/unit/` directory already exists alongside `tests/integration/`, so the path `tests/unit/profile-admin-section.test.ts` is valid.

5. **UI design choice — PASS**

   Option (b) is the right call. BottomNav already has four slots plus a conditional Sign-In slot for unauthenticated users; a sixth conditional slot for `global_admin` would complicate layout permutation analysis and push the nav toward 320px width on the smallest phones. `/games` is a low-frequency operator surface (used once per new game added to the catalog) that 99% of party attendees never touch. The Profile page is the natural home for operator-only controls — it is already role-annotated (`Role: {session.user.role}` in line 52 of `profile/page.tsx`). The pattern also composes well with M6: a "Bet audit" view is a natural second entry under the same Admin section. The `session.user.role === 'global_admin'` gate is already used idiomatically in `app/games/page.tsx` (redirect-to-leaderboards for non-admins), so the conditional pattern is consistent.

6. **Migration safety — PASS**

   The task correctly states the existing hand-promoted player is unaffected. Source verification: `maybePromote` in `lib/db/players.ts` lines 66-74 short-circuits for an existing `global_admin` via the condition `player.role !== 'global_admin'` on line 69. If all three conditions (`bootstrapAdminDiscordId &&`, `player.discord_id === bootstrapAdminDiscordId &&`, `player.role !== 'global_admin'`) are not all true, it falls through to the no-op return on line 74: `{ playerId: player.id, role: player.role, created: false, promoted: false }`. An already-`global_admin` player's role is preserved. This is correct.

7. **Symbol alignment — PASS with OBSERVATION**

   `app.first_admin_bootstrap = "env_discord_id_optional"` in `symbols/manifest.json` line 130 already accurately describes the optional env var mechanism. H1 does not change the semantics of the admin bootstrap — it fixes the delivery mechanism (wizard now emits the var instead of requiring a manual `kubectl set env`). The property value remains accurate post-H1. No symbol property change is required. The task's alignment step (verify `align.py check` exits 0, no lock regeneration) is correct.

   OBSERVATION: The task could optionally add a `wizard_bootstrap_delivery` property to the `app` symbol (value `"wizard_configmap"` post-H1 vs. the former `"kubectl_set_env"` out-of-band step) to make the wizard's role in the bootstrap chain explicit and machine-verifiable. This is not required for H1 — the existing property is still truthful — but would help M6 authors understand the full chain at a glance without reading the M3/M4 task docs.

8. **Forward-compat / hand-offs to M6 — PASS**

   The hand-offs are specific and actionable, not hand-wavy. The Admin section pattern is documented with a concrete JSX snippet that future implementers can follow without re-deriving the decision. The wizard.yaml chain hand-off correctly identifies the `SECRET_FIELDS` vs. `CONFIG_FIELDS` split and the `APP_RUNTIME_SECRET_KEYS` gate in `render_plain_secret`, which is the subtlety a future operator-secret addition (e.g., a Stripe key) would need to navigate. Both hand-offs reference the actual source locations.

9. **Verification plan completeness — CONCERN (MINOR)**

   The live verification loop is solid and mirrors the three prior hotfix patterns (wizard `--retry-from generate_manifests` → ArgoCD reconcile → `kubectl rollout restart` → `printenv`). One step is missing: after the wizard re-run but before `kubectl rollout restart`, the operator should confirm the generated `K8s/configmap-web.yaml` in the local workspace (or after it is committed to GitHub and seen by ArgoCD) actually contains the `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` key. The task jumps from wizard run to pod restart to `printenv` in the pod, skipping the intermediate ConfigMap diff check. Adding a `kubectl --kubeconfig=... -n eloup get configmap eloup-web-config -o yaml | grep BOOTSTRAP` step after ArgoCD syncs (or after the local manifests are committed) would catch a silently-missing key before the pod restart. This is a MINOR gap — the `printenv` step at the end would catch it anyway — but the earlier check shortens the feedback loop.

   The `--retry-from generate_manifests` pattern is correctly scoped: it regenerates only the manifests without re-running phases 2-5, which is the right surgical hotfix shape.

10. **Anything that looks wrong — CONCERN (BLOCKING)**

    The `config.py` `CONFIG_FIELDS` tuple and `CollectedConfig` dataclass do not include `bootstrap_admin_discord_id` today (verified by reading lines 13-38 of `wizard/wizard/config.py`). The task describes adding it to both. The BLOCKING concern is the interaction with `load_yaml_config` lines 67-69:

    ```python
    unknown = set(data) - set(ALL_FIELDS)
    if unknown:
        raise ConfigFileError(f"{path}: unknown keys: {sorted(unknown)}")
    ```

    `ALL_FIELDS = CONFIG_FIELDS + SECRET_FIELDS`. If `bootstrap_admin_discord_id` is added to `CONFIG_FIELDS` but the task's description of the `to_dict()` return also needs updating (`CollectedConfig.to_dict()` currently returns `asdict()` which serializes all dataclass fields), the implementer must confirm that `generate_manifests.py`'s `config.get("bootstrap_admin_discord_id")` reads from `state.data["config"]` (a plain dict populated by `state.update_config(config.to_dict())`), not from a `CollectedConfig` instance directly. This is the plumbing path: `_from_yaml_only → CollectedConfig → to_dict() → state.update_config() → state.data["config"] → generate_manifests._run() → config.get(...)`. If `CollectedConfig` is a dataclass with `bootstrap_admin_discord_id: str | None = None` and `to_dict()` calls `asdict()`, the `None` value will appear in the dict as `None`, and `config.get("bootstrap_admin_discord_id")` will return `None` (not raise KeyError). That path is correct.

    However, `_from_yaml_only` (lines 77-99 of `prompts.py`) constructs `CollectedConfig` with positional or keyword args. Adding a new field with a default of `None` to `CollectedConfig` means `_from_yaml_only` must explicitly pass `bootstrap_admin_discord_id=data.get("bootstrap_admin_discord_id") or None` (normalizing `""` to `None`). If the implementer forgets this keyword arg, Python will use the dataclass default of `None` regardless of what the YAML says — silently ignoring a populated `bootstrap_admin_discord_id` in the YAML. The task's description covers this (`_from_yaml_only reads data.get("bootstrap_admin_discord_id") and passes through None when missing`) but the empty-string normalization (`data.get("bootstrap_admin_discord_id") or None` rather than `data.get("bootstrap_admin_discord_id")`) must be explicit in the implementation to prevent `""` from the YAML template flowing through as a non-None string. This is a correctness requirement, not merely cosmetic. The test for "empty string in YAML normalizes to omitted key" (mentioned as optional in the task) should be REQUIRED given this risk.

    This is rated BLOCKING: the implementation plan must add the empty-string-normalization test (present in the optional list today) to the required test list, and the implementer must use `data.get("bootstrap_admin_discord_id") or None` (not just `.get(...)`) in `_from_yaml_only`.

## Required changes before implementation

- **Add the empty-string normalization test to the required test list** (currently listed as optional). `_from_yaml_only` must use `data.get("bootstrap_admin_discord_id") or None` — a YAML value of `""` must produce an omitted ConfigMap key, not an empty-string key. A test asserting this at the pure-`render_configmap` level is required to guard this boundary, not merely optional.
- **Name the helper file explicitly.** The task says `components/ProfileAdminSection.tsx` "(or inline in `lib/permissions.ts`)" — this ambiguity should be resolved in the task doc before commit 4 to avoid scope drift between commits 3 and 4. Pick one location; `lib/permissions.ts` is already a pure-logic file that the test can import without Next.js context and is the cleaner choice.

## Suggested but not blocking

- Add a pure `render_configmap` unit test pair (present/absent) to `test_generate_manifests.py` alongside the two phase-level tests. Three lines of test code, tight boundary.
- Add an intermediate ConfigMap inspection step to the live verification plan (step 6): `kubectl -n eloup get configmap eloup-web-config -o yaml | grep -i bootstrap` after ArgoCD syncs, before `rollout restart`. Shortens feedback loop if the key is silently absent.
- Consider adding `wizard_bootstrap_delivery: "wizard_configmap"` to the `app` symbol in `symbols/manifest.json` to make the wizard's role in the bootstrap chain machine-verifiable. Not required — the existing `first_admin_bootstrap: "env_discord_id_optional"` remains accurate.
- Acknowledge the backward-incompatibility window for operators who add `bootstrap_admin_discord_id` to their `wizard.yaml` before upgrading the wizard image. A comment in the wizard.yaml template ("requires wizard image ≥ H1") would suffice.

## Independent Review Rule

`## Author: claude-opus-4.7-h1-implementer` vs `## Reviewer: claude-sonnet-4-6-h1-reviewer` — different agents, rule satisfied.
