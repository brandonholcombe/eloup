# Review — DIAG memory probe on /api/health

## Reviewer: claude-opus-4.8-diag-reviewer

Reviews task `diag-mem-probe.md` (Author: `claude-opus-4.8-diag-implementer`).

## Verdict: Request-changes

The diagnostic itself is sound and low-risk, but the doc's core safety claim
is factually wrong: there **is** an e2e test asserting the exact
`/api/health` body shape with strict equality, and the proposed change will
break it (and therefore `pnpm test` / CI, which the doc claims stays green).
The remedy is small and well-defined, but it must be added to the plan before
implementation — the change as scoped ("that's the entire change") fails the
test suite.

---

## Findings

### 1. BLOCKING — e2e golden-path asserts exact body shape; change breaks it
`eloup-web/e2e/golden-path.spec.ts:15`:

```ts
const health = await request.get('/api/health');
expect(health.status()).toBe(200);
expect(await health.json()).toEqual({ ok: true });
```

Playwright's `toEqual` is a strict recursive deep-equality. Adding `uptime_s`
and the `mem` block makes the actual body `{ ok: true, uptime_s, mem: {...} }`,
which is **not** deep-equal to `{ ok: true }` — the assertion fails.

This directly contradicts the doc's claims:
- "the liveness/readiness probes assert HTTP 200, not the body shape ... so
  adding fields can't break them" (true for probes, see finding 2) — but the
  doc generalizes this to conclude no test cares about the body.
- Testing section: "the health route has no test asserting body shape —
  verify." Verified: **false.** `golden-path.spec.ts:15` asserts it exactly.
- Testing section: "`pnpm lint` / `typecheck` / `build` / `test` green." The
  e2e test would go red.

**Required change:** relax the assertion to check the `ok` field only, e.g.
`expect((await health.json()).ok).toBe(true)` or
`expect(await health.json()).toMatchObject({ ok: true })`. This edit to
`e2e/golden-path.spec.ts` must be part of the task, and (if the probe is
reverted rather than env-gated per finding 6) reverted alongside it. Update the
doc's "no test asserting body shape" claim accordingly.

### 2. PASS — k8s probes assert status only, not body
`K8s/statefulset-web.yaml:37-52`:

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

Both are `httpGet` with no body/regex match — Kubernetes treats any 2xx/3xx as
success. Adding response fields cannot affect the probes. The doc's probe claim
is correct.

### 3. PASS — success-only extension, error path preserved
`eloup-web/app/api/health/route.ts:7-16` currently returns
`NextResponse.json({ ok: true })` on success and a 503 `{ ok: false, error }`
in the catch. The proposed snippet replaces only the success `return` and
leaves the `db().prepare('SELECT 1').get()` probe check and the 503 branch
untouched. Scope is as described.

### 4. Should-fix — public unauthenticated info leak (minor)
`/api/health` is public and unauthenticated. Exposing `rss`/`heapTotal`/
`heapUsed`/`external` reveals the process memory footprint and its proximity to
the 768Mi limit; `uptime_s` reveals restart/OOMKill timing — which, given the
instability being investigated, is exactly the kind of signal that advertises
"this pod is flaky / restarts often" to any observer. Severity is low (no
secrets, no user data, no paths), and it is temporary, so it is acceptable for
a short diagnostic window. But it is not "not sensitive" in the absolute sense
the doc implies. This concern is best resolved by env-gating (finding 6), which
keeps the fields out of the default public response entirely.

### 5. PASS (with two doc nits) — diagnostic reasoning is sound
- **rss vs heapUsed to separate native vs JS growth: correct.** `heapUsed` is
  the V8 JS heap; `rss` is total resident set including native allocations
  (better-sqlite3 buffers, Node internals, thread stacks). rss climbing while
  heapUsed stays flat is a valid native-growth signal, and the plan's inclusion
  of `external`/`arrayBuffers` (which capture C++/ArrayBuffer memory bound to
  JS) sharpens the native-vs-JS distinction. Interpretation table is reasonable.
- **`nodejs` + `force-dynamic`: correct and necessary.** `process.memoryUsage()`
  needs the Node runtime (not edge) — `runtime = 'nodejs'` is already set
  (route.ts:5). `dynamic = 'force-dynamic'` (route.ts:4) prevents the route
  from being statically evaluated/cached, so each poll returns fresh numbers.
  No gotcha; both are already in place.
- **Nit:** the doc calls `process.memoryUsage()` "a fast syscall-level read." It
  actually queries V8 heap statistics in addition to reading RSS, so it is
  slightly more than a single syscall — but still cheap, and negligible at the
  probe cadence (readiness ~5s, liveness ~10s). Immaterial; not a blocker. If
  cost ever mattered, `process.memoryUsage.rss()` is the lighter variant, but
  it is not needed here.
- **Nit:** rss reflects the whole Node process, which is correct given a single
  replica (`replicas: 1`, statefulset-web.yaml:10). The doc already notes this.

### 6. Optional (recommend Should-fix) — env-gate instead of manual revert
The follow-up is described in prose ("REVERT this probe ... Track as a checklist
item in this doc") but no actual checklist item exists in the doc, and a manual
revert is easy to forget — leaving the info leak (finding 4) in prod
indefinitely, which is the exact failure the follow-up is meant to prevent.
Prefer gating the `mem`/`uptime_s` block behind an env flag (e.g. only include
it when `process.env.DIAG_MEM === '1'`). Benefits: (a) default public response
stays minimal, resolving finding 4; (b) no code revert needed — just unset the
env var; (c) the e2e test still passes unchanged when the flag is off, which
also softens finding 1 (though the test relaxation is still the cleaner fix if
the flag will be on in the environment e2e runs against). If you keep the
plain revert approach, add a real, checked follow-up item rather than a prose
mention.

---

## Summary
- 1 Blocking: e2e `golden-path.spec.ts:15` `toEqual({ ok: true })` breaks;
  doc's "no body-shape test" claim is false.
- 2 Should-fix: public info-leak framing; prefer env-gate over manual revert.
- Probe claim (finding 2), scope (finding 3), and the native-vs-JS reasoning
  (finding 5) all check out. The change is fine once the e2e assertion is
  updated and the doc's test claim corrected.
