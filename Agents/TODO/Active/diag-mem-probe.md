# DIAG — Temporary memory probe on /api/health

## Author: claude-opus-4.8-diag-implementer
## Status: Complete

## Conclusion (2026-07-29) — NO LEAK

After ~72h uptime the live pod reads **rss 123 MB / heapUsed 46 MB** — flat vs
the ~125 MB under-load measurement, **0 restarts / 3 days**. Combined with the
load test (flat 87–136 MB, recedes when idle) this is definitive: **no memory
leak.** The historical OOMs were spike-driven (RC import / write / concurrency
bursts during real parties), not steady-state growth; 768Mi is comfortable for
the ~123 MB steady state. Probe **disabled** by removing `DIAG_MEM` from
`configmap-web.yaml` (the gated health-route code stays dormant/reusable — no
revert needed). Follow-up if OOMs ever recur during a party: profile the
RC-import path specifically.

## Reviewer findings folded (2026-07-26)

Review at `Agents/Review-reports/diag-mem-probe-review.md` (Reviewer:
`claude-opus-4.8-diag-reviewer`): **Request-changes** — 1 blocking, 2 should-fix.
Probe-safety and scope claims verified correct; reasoning sound. Folded:
- **BLOCKING (corrected):** my "no test asserts body shape" claim was WRONG —
  `e2e/golden-path.spec.ts:15` does `expect(await health.json()).toEqual({ ok:
  true })` (strict deep-equality); unconditionally adding fields turns CI red.
- **Should-fix (adopted):** **env-gate the probe behind `process.env.DIAG_MEM`**
  instead of always-on + manual revert. This resolves the blocking issue too:
  with the flag OFF (CI/e2e default) the response stays exactly `{ ok: true }`,
  so **the e2e test passes untouched** — no test edit needed. It also makes the
  probe dormant-by-default (no info-leak unless explicitly enabled) and removes
  the forgotten-revert risk (dormant code can stay).
- **Should-fix (acknowledged):** exposing rss/heapTotal/uptime does leak the
  memory footprint / proximity-to-limit / restart timing — low severity and now
  opt-in via the flag, so acceptable for the observation window.

## Purpose (diagnostic, temporary)

`eloup-web-0` OOMKills at the 768Mi limit intermittently (~4/day at 768Mi, was
~14/day at 512Mi). Investigation ruled out a JS-level leak: per-request
`.prepare()` **plateaus** (local repro — 27MB warmup then flat across equal
batches, not linear), and static analysis found **no** module-level accumulator,
cache, `React.cache`/`unstable_cache`, timer, or listener. Remaining hypotheses:
(a) **native-layer** growth below the V8 heap (better-sqlite3 / Node internals),
or (b) **not a leak** — a marginally tight limit + spiky peak usage.

metrics-server is unavailable and prod `kubectl exec` is gated, so we need
another way to observe the memory trend. This adds a lightweight, PUBLIC,
pollable memory readout to the existing `/api/health` endpoint so we can watch
**RSS vs V8 heap** over hours and distinguish native-vs-JS growth and
leak-vs-plateau — without shell access to the pod.

## Change

In `eloup-web/app/api/health/route.ts`, extend the **success** response only
(keep the 503 error path unchanged), **gated behind `process.env.DIAG_MEM`** so
the default response is unchanged:

```ts
db().prepare('SELECT 1').get();
if (process.env.DIAG_MEM) {
  const m = process.memoryUsage();
  return NextResponse.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    mem: {
      rss: m.rss,
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      external: m.external,
      arrayBuffers: m.arrayBuffers,
    },
  });
}
return NextResponse.json({ ok: true });
```

Read `process.env.DIAG_MEM` directly (NOT via `lib/env` zod schema) so no schema
change is needed. Do not touch the `SELECT 1` probe check or the 503 branch.

**Enable in prod for the observation window:** add `DIAG_MEM: "1"` to
`K8s/configmap-web.yaml` (the pod already loads it via `envFrom
configMapRef: eloup-web-config`). Disabling later = remove that one line + roll
(no image change, no code revert). With the flag unset (CI, local, e2e) the
endpoint returns bare `{ ok: true }`, so `golden-path.spec.ts:15`'s
`toEqual({ ok: true })` stays green with **no test edit**.

## Why this is safe

- **Probes unaffected:** the liveness/readiness probes assert HTTP 200, not the
  body shape (`K8s/statefulset-web.yaml` uses `httpGet` on `/api/health` with no
  body match), so adding fields can't break them.
- **Minor, opt-in info exposure:** memory counters + uptime do reveal the
  footprint / proximity-to-limit / restart timing to anyone — low severity, and
  gated OFF by default (`DIAG_MEM` unset), so only exposed during the deliberate
  observation window. No user data, config, or paths.
- **Cheap:** `process.memoryUsage()` is a fast syscall-level read; the endpoint
  is already `force-dynamic` `nodejs` runtime.
- **Reversible:** temporary. Revert once the trend is characterized (tracked as
  a follow-up so we don't leave it in prod indefinitely).

## Interpretation plan (after deploy)

Poll `https://eloup.kodloki.io/api/health` every few minutes for ~2h and chart
`mem.rss`, `mem.heapUsed`, `mem.external` vs `uptime_s`:
- **rss climbs, heapUsed flat** → native leak (better-sqlite3 / native) → next:
  audit native retention (statement finalization under real GC pressure, WAL).
- **heapUsed climbs** → JS leak after all → re-hunt with a heap snapshot.
- **rss sawtooths around a high baseline, never monotonic** → NOT a leak; the
  768Mi limit is just tight for peak load → bump to 1Gi and/or add LIMITs to the
  unbounded `.all()` on matches/profile.

NB: a single pod serves all traffic, so `rss` reflects real usage; correlate
spikes with any concurrent load.

## Testing / verification
- `pnpm lint` / `typecheck` / `build` / `test` green. NOTE:
  `e2e/golden-path.spec.ts:15` asserts `toEqual({ ok: true })` — with `DIAG_MEM`
  unset (CI default) the response is unchanged, so it stays green with no edit.
- Manual with flag on: `DIAG_MEM=1 … curl /api/health` returns `ok:true` + the
  `mem` block, status 200; with flag off, bare `{ ok: true }`; 503 path untouched.
- `align.py check` OK (no symbol change).

## Findings so far (2026-07-26)

Probe deployed (image `4f841d7`, `DIAG_MEM=1`). Fresh pod baseline: **rss 96 MB /
heap 35 MB** at 39s uptime. A controlled read-only load test (3,600 requests over
~18 min across `/leaderboards`, `/racing`, `/api/leaderboards`, `/`) then sampled
`/api/health`:
- rss stayed in **87–136 MB** through all 3,600 requests (one-time ~40 MB warmup,
  then flat; dipped to 118 mid-run as GC reclaimed).
- On idle after load, rss **receded to ~113 MB** (132→113) — memory IS reclaimed.

**Verdict: the public read paths have NO leak** — stable ~125 MB working set with
huge headroom under 768 Mi. Combined with the earlier repro (per-request
`.prepare()` plateaus) and static analysis (no module-level accumulators), the
~6h OOMs are **not** steady-state read-path growth. They are spike-driven on paths
this anonymous load can't reach: **RC import** (`/api/racing/import` parses files /
builds arrays) or **write/concurrency bursts** during real party use. Leaving the
probe ON to catch an organic (authenticated/party) climb before concluding.

## Follow-up (do not skip)
After the trend is captured, REVERT this probe (or gate it behind an env flag)
so prod `/api/health` returns to its minimal shape. Track as a checklist item in
this doc.

## Review gate
Edits `eloup-web/`, so needs an independent review report in
`Agents/Review-reports/` by a different agent than `## Author:`, referencing
`diag-mem-probe.md`, before implementation.
