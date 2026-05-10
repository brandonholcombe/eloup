# Review: project-review-and-plan.md

## Reviewer: claude-sonnet-4-6-reviewer
## Date: 2026-05-09
## Verdict: APPROVE WITH NOTES

## Summary

The plan in `project-review-and-plan.md` is solid and well-researched — cluster facts are accurate, the wizard phasing is sensible, and the mobile-first commitment is explicit and correctly threaded through the UI section. However, there are three issues that must be resolved before M1 begins (none are outright blockers for writing M1 code, but two will create correctness bugs at M4/M6 if ignored), plus several notes the implementer should address proactively rather than discover during implementation.

---

## Issues found

**1. [MAJOR] BET-2 / RATE-1 race condition: open bets can reference overall ELO the bettor no longer has**

The plan decides: overall ELO is the wager currency (Q-BET-2) AND overall ELO is a live mutable field updated per match (Q-RATE-1). The domain model shows `bets.amount_elo` as a stored integer and `overall_ratings.current_rating` as a mutable balance. The plan says bets "debit" overall ELO at placement time, but the confirmation flow says ELO updates happen atomically when `pending → confirmed`.

The race: Player A places a 50-point bet while their overall ELO is 1200. Before that bet settles, a different match (Match X) confirms, dropping their overall ELO to 1155. The original bet's 50-point debit was never actually locked — `overall_ratings.current_rating` is now 1155, but the 50-point bet is still `status=open`. If Match Y (the bet's match) then confirms and Player A loses, the system tries to subtract 50 from 1155 = 1105. That math works, but the *effective* cap enforcement from placement time is now wrong relative to Match Y's actual delta.

More critically: the plan says nothing about whether overall ELO is **reserved/escrowed at placement time** or only debited at settlement. If bets are merely recorded without immediate reservation, a player can bet their full balance on multiple simultaneous open matches with no cross-match cap enforcement. The server-side cap check at `bet placement` only compares against the *instantaneous* balance at that moment, not the committed balance accounting for all open bets.

**Suggested fix:** At bet placement, debit the wager immediately into an `escrowed_elo` field on the `bets` row (subtract from `overall_ratings.current_rating` at placement, return or award at settlement). Add a `SELECT FOR UPDATE` (or SQLite `BEGIN IMMEDIATE`) around the check-and-debit to prevent double-spend. Document this clearly in the betting symbol when it is created.

---

**2. [MAJOR] Wizard phases 3 and 8 have partially-specified idempotency for the externally-visible side effects**

Phase 3: The plan says "if either repo already exists, skip creation but verify push access." That handles the trivial restart case. But it does not handle the case where the Gitea repo was created, the wizard state file was written, and then the wizard process was killed before the GitHub repo was created. On restart, the wizard reads `phase 3: done` in the state file — but which repos actually exist? The state file records phase-level completion, not per-remote completion within the phase.

Phase 8 (DNS): The plan correctly notes the A-record creation is idempotent (skip if already `172.232.176.47`). But the state file only records `dns: done` after both the Linode API call AND whatever comes next. If the Linode API call succeeds and the wizard crashes immediately after, the next run re-checks DNS (the record exists) and skips, which is correct. This one is actually fine — Linode DNS is idempotent at the resource level.

For Phase 3, there is a real gap: within-phase partial progress. The state file granularity needs to be per-remote, not per-phase, for Phase 3: `{gitea: done, github: pending}` is a legal intermediate state that the wizard must resume from correctly.

**Suggested fix:** Expand the state schema for Phase 3 to track `{gitea_repo: done|pending, github_repo: done|pending}` independently. The wizard checks each remote's actual existence via API before marking it complete, regardless of what the state file says.

---

**3. [MINOR] M4 milestone still references "Google OAuth" — this is a stale copy-paste from before Discord was decided**

In §5 (Phasing / Milestones), M4 reads: "EloUp web app MVP: Google OAuth, players, games, matches, leaderboards, PWA install." Discord OAuth was confirmed and is correctly described everywhere else in the document. This is a documentation bug in §5 only, but if a future implementer skims §5 without reading §4.2 they will build the wrong auth provider.

**Suggested fix:** Change M4's gating description to "Discord OAuth" before any implementer reads §5 as their work order.

---

**4. [MINOR] Secret handling in gitops (Q-WIZ-4) is left open but the selected options have meaningfully different security surfaces**

The plan proposes Sealed Secrets (option a) for in-cluster secrets because secrets are committed to two remotes (Gitea + GitHub). However, the plan also notes captain-sonar uses option (c) — plain secrets applied directly via kubectl, never committed. The decision is deferred to Q-WIZ-4.

If the implementer defaults to Sealed Secrets without the user confirming they want to install the Sealed Secrets controller, the wizard will apply a CRD that may conflict with or be absent from the cluster. The cluster_conventions memory does not mention Sealed Secrets as a platform component — it is notably absent from the "already installed, do NOT re-install" list.

**Suggested fix:** Before the implementer writes the secret manifest template, the user should explicitly confirm Q-WIZ-4. The safe default, given that captain-sonar uses option (c) and the cluster has no noted Sealed Secrets presence, is option (c): kubectl-applied secrets, `.gitignored` locally, wizard documents the required env vars. Sealed Secrets requires an extra controller installation that must be planned for.

---

**5. [MINOR] StatefulSet vs Deployment shape mismatch with cluster_conventions memory**

Q-ARCH-1 correctly decides `StatefulSet` for stable PVC binding. However, `cluster_conventions.md` documents the "standard deployment shape from shine" as a `Deployment` with `RollingUpdate (maxSurge: 1, maxUnavailable: 0)`. A StatefulSet with `replicas: 1` and SQLite behaves differently during updates: by default it uses `RollingUpdateStatefulSetStrategy` which terminates the old pod before starting the new one (equivalent to `Recreate` semantics for a single-replica set), causing brief downtime on every image upgrade.

The plan acknowledges "brief downtime during pod recreates / image upgrades" — this is acceptable — but the manifest generator in the wizard needs to explicitly use `StatefulSet` manifest shape, not copy the `Deployment` template from shine wholesale. The `securityContext.fsGroup: 1000` from shine is still needed and works on StatefulSet; this is worth calling out since it's easy to miss when adapting a template.

**Suggested fix:** The manifest generation phase must use a `StatefulSet` template, not a `Deployment` template. Add a note in the wizard's Phase 6 logic that it cannot simply clone shine's deployment YAML.

---

**6. [MINOR] Bet cap rule (Q-BET-3) computes ceiling from per-game ELO delta but bets are denominated in overall ELO — the two are incommensurable**

The confirmed rule is: cap = `max(|rating_delta|)` across participants in their per-game ELO. Bets are denominated in overall ELO. These are different rating pools with different histories. A player with per-game ELO 900 playing a 1200 player might have a 32-point per-game delta cap, while their overall ELO is 1400. The cap is small relative to their actual balance. Conversely, a player might have an overall ELO of 800 and a per-game delta cap of 45 — the server would accept a 45-point overall ELO bet from a player with only 800 overall ELO (math fine) but also from a player with 30 overall ELO (math breaks: negative ELO).

The plan does not define a floor. Overall ELO can go negative under the current spec if bets are lost on a low-balance bettor.

**Suggested fix:** Two things the implementer must add that are not in the plan: (a) a minimum overall ELO floor (zero is the obvious choice — betting cannot leave you below 0), and (b) the cap at placement is `min(per_game_delta_cap, bettor_available_overall_elo)`. Both are server-side validations.

---

**7. [MINOR] Dependency ordering: M4 can start before M3 but the plan implies it cannot**

The plan lists M3 (wizard phases 5–7: manifest generation, ArgoCD sync, healthy URL) as a prerequisite for M4. In practice, the Next.js app can be scaffolded, tested locally, and developed to feature-complete independently of the wizard. The wizard's job is to deploy the app, not to build it. M4 can begin as soon as the domain model and auth are clear (post-M0), even if the wizard is still in-progress.

This is not a correctness issue, but it represents a sequencing opportunity the plan misses. An implementer who reads the milestone table linearly will wait for a fully-working wizard before writing any app code, when the two workstreams are largely parallel.

**Suggested fix:** Add a note to §5 that M4 app development can proceed in parallel with M2/M3 wizard work; M3 completion is only required for the app to be reachable at its production URL.

---

## Coverage check

Requirement from the user's original prompt vs plan coverage:

- [x] Kubeconfig + API keys input — Phase 2 collects these; Phase 1 validates kubeconfig
- [x] Graceful failing + restart — resumable state file with per-phase status, `--retry-from`, `--reset` flags, cleanup hooks
- [x] AMD64 images — `--platform linux/amd64` confirmed; Pi service noted as ARM64
- [x] ArgoCD — Phase 4 detects existing ArgoCD; Phase 7 applies Application CRD
- [x] DockerHub — Phase 5 builds and pushes; image prefix `bholcombe/eloup-*` matches org convention
- [x] Multi-game 1v1/FFA/teams up to 8v8 — `games.format ENUM('1v1','ffa','team')` with `min_participants`, `max_participants`; team ELO model in Q-RATE-2 (unanswered but acknowledged)
- [x] Discord auth (replaced Google) — §4.2 stack, next-auth Discord provider, scopes `identify email`, verified email gate
- [x] Tournaments + admin delegation + invite links — `tournaments`, `tournament_admins` tables; invite_token on tournament; Q-TOURN-* questions cover delegation rules (Q-TOURN-4 deferred but flagged)
- [x] Per-game and overall ELO leaderboards — `ratings` and `overall_ratings` tables; distinct update paths
- [x] Pre-match betting cap — Q-BET-3 decided: `max(|rating_delta|)` across participants; server-side validation at placement
- [x] Hidden betting feature — long-press / gesture reveal; hidden by default; `bets` table
- [x] KYTO heart-rate deferred — §4.3 acknowledged, placeholder manifests planned, deferred until KYTO docs land
- [x] PWA mobile-friendly — §4.2 entire block; bottom nav, 44px targets, iOS safe-area, installable, service worker

**Gap:** Q-RATE-2 (team ELO update model for 8v8) is unanswered and has no bold default in the plan. Team formats are in scope for MVP but the actual computation path is unresolved. The implementer will reach team-match entry and have no authoritative spec. This should be resolved before M4.

**Gap:** Q-BET-5 (can participants bet on themselves?) is unanswered with no default. Participant self-betting is a meaningful design choice for match-fixing avoidance. Given the feature is hidden by default and the audience is a trusted party group, the plan should at least provide a default (suggest: allow, since social enforcement at a party is sufficient).

**Gap:** Gitea owner `brandonw.h2o` contains a dot — the wizard must URL-encode or handle this correctly in API paths (`/api/v1/repos/brandonw.h2o/eloup` is valid in Gitea but the dot can trip up naive URL construction).

---

## Strengths worth keeping

- **Cluster fact-checking is thorough.** The plan correctly reads the live cluster rather than guessing. Storage class, ingress class, ClusterIssuer, LoadBalancer IP, ArgoCD repo convention — all verified and specific. This is the kind of grounding that prevents day-one deployment failures.
- **Mobile-first is a real constraint, not lip service.** The plan calls out bottom nav, 44px targets, iOS safe-area insets, the iOS install hint, the Konami-code prohibition, and the separate projection route. These are the right specifics. Implementers should not refactor these into "we'll do mobile later."
- **SQLite + StatefulSet + single-replica is the right MVP choice.** Matches the org pattern, avoids Postgres operational overhead, and the confirmed storage class supports expansion. Don't let future agents talk you into Postgres until you actually hit a concurrency or replication requirement.
- **The dual-remote push model (Gitea mirror + GitHub canonical) is clearly specified.** Gitea as mirror, GitHub as ArgoCD source — no split-brain in the sync path, and the org's existing ArgoCD creds remain sufficient.
- **Overall ELO as its own independent ELO (not a derived view) is the right call for betting.** A derived view cannot be safely mutated for bet credits/debits. Making it a first-class, independently-tracked rating field with its own K and starting value is architecturally correct.
- **The projection dashboard is a separate route.** This will prevent the inevitable "let's make the mobile view scale up" compromise that would degrade both surfaces. Keep it separate.

---

## Recommended follow-ups for the implementer

1. **Resolve Q-WIZ-4 before writing any secret manifests.** Default to option (c) (kubectl-applied, gitignored) unless the user explicitly confirms they want the Sealed Secrets controller installed on tow-c1. Do not assume it is present.

2. **Add escrow semantics to the betting model.** Before implementing any betting code, decide and document: bets reserve overall ELO at placement (immediate debit to escrow), not at settlement. This is the only model that prevents double-spend without complex cross-bet cap enforcement.

3. **Add a floor to overall ELO.** Define `min_overall_elo = 0` in the rating symbol. Overall ELO cannot go below zero from bet losses. This prevents negative balances and makes the floor semantically equivalent to "broke."

4. **Resolve Q-RATE-2 (team ELO) before M4 begins.** The plan lists team format in the schema but leaves the computation undefined. The bold default approach is option (a): each team member gets the same delta computed from team-average ratings. Confirm this with the user or pick it as the default before any match-recording code is written.

5. **State file granularity for Phase 3.** Track `{gitea_repo: done|pending, github_repo: done|pending}` as separate fields, not a single phase-level `done`. The wizard should verify each remote's actual state via API on startup, not trust a stale state file entry.

6. **Fix the M4 milestone label** from "Google OAuth" to "Discord OAuth" before any milestone is filed as a task document.

7. **URL-encode the Gitea owner** (`brandonw.h2o`) in any HTTP client call that constructs repo API paths. Python's `urllib.parse.quote` or `requests`' built-in URL construction handles this, but verify in the Gitea API client code.

8. **Confirm Q-BET-5** (participant self-betting allowed?) and add a database constraint if disallowed — it cannot be enforced in UI alone since the feature is deliberately obscured.
