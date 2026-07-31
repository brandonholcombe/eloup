# OPS — Nightly SQLite backups to an in-cluster PVC

## Author: claude-opus-4.8-backups-implementer
## Status: Complete

## Outcome (2026-07-31) — VERIFIED WORKING

Deployed and proven end-to-end. A manual test job
(`kubectl create job --from=cronjob/eloup-web-backup`) Succeeded and produced
`/backups/eloup-20260731T235503Z.sqlite` (512KB); independent inspection from a
throwaway pod confirmed `PRAGMA integrity_check = ok` and real data (5 players).

**One deploy-time fix beyond the review:** the app's node runs at 100% CPU
*requests* (2000m/2000m reserved), and the backup must co-locate there (RWO), so
the job stayed Pending until `requests.cpu` was set to `"0"` (no reservation,
bursts on spare cycles). Committed in `9b1fe42`. Memory (64Mi) fit fine.

Shipped: `bholcombe/eloup-sqlite` (digest-pinned sqlite3 image),
`K8s/pvc-backups.yaml`, `K8s/cronjob-backup.yaml` (nightly 03:00 UTC, keep 7,
integrity gate, restore runbook). First automatic run: tonight 03:00 UTC.

## Reviewer findings folded (2026-07-31)

Review at `Agents/Review-reports/ops-sqlite-backups-review.md` (Reviewer:
`claude-opus-4.8-backups-reviewer`): **Approve-with-changes** — 2 blocking, 6
should-fix. Crux confirmed: **the CronJob same-node RWO co-mount IS viable**
(RWO = single-node; the backup pod gets a bind mount of the already-staged ext4,
not a second raw mount → no corruption, no extra VM attach). Folded:
- **BLOCKING-1:** mount `/data` **read-WRITE**, not readOnly. WAL open needs to
  map/write `-shm`; a readOnly mount makes `.backup` fail to open the source.
  Safe: two processes on one host/filesystem is SQLite's designed case; the app
  connection stays open so the CLI exit never triggers a last-connection
  checkpoint.
- **BLOCKING-2:** drop `alpine + apk add sqlite` at runtime (`apk add` needs root
  but the pod is `runAsNonRoot`/uid 1000, + nightly runtime-egress fragility).
  Use a **prebuilt digest-pinned image containing `sqlite3`** → building
  `bholcombe/eloup-sqlite` (alpine + sqlite at BUILD time, non-root runtime).
- **Should-fix:** `set -euo pipefail`; assert `integrity_check` output `== ok`
  (a bare PRAGMA exits 0 even on errors); `find`-based prune (robust vs BusyBox
  `xargs -r`); add `backoffLimit`/`activeDeadlineSeconds`/job resources; tighten
  restore runbook (one throwaway pod mounting BOTH PVCs; integrity-check the
  restored file). Keep the hard `podAffinity` (selector `app: eloup-web`
  verified present).

## Scope note (user, 2026-07-31)

**Not a mission-critical deployment — keep it simple, no offsite.** Offsite /
Object Storage is explicitly OUT (not a deferred follow-up). This protects
against logical damage (bad DELETE, corruption, app bug) — both PVCs are Linode
block volumes in the same region (us-sea-2, same failure domain); infra/region
loss is knowingly not covered. No elaborate alerting/monitoring — a plain nightly
dump + prune + integrity gate is the whole scope.

## Purpose (resolves Q-ARCH-2)

`eloup-web` stores everything in a single SQLite file (`/data/eloup.sqlite`) on
one 5Gi `linode-block-storage-retain` PVC (`data-eloup-web-0`). `retain` protects
against accidental PVC deletion, but there is **no** protection against DB
corruption, a bad DELETE/UPDATE, or filesystem loss. This adds a nightly backup.

**Decisions (user, 2026-07-31):**
- **Target:** a **separate in-cluster PVC** (`eloup-backups`). Simple, no new
  creds, ships now. NOT offsite — a full cluster/region loss is not covered;
  Linode Object Storage upload is a clean v2 follow-up (`ops-sqlite-backups-offsite`).
- **Schedule/retention:** **nightly, keep the last 7** dumps.

## Design

New manifests in `K8s/`:

### 1. `pvc-backups.yaml` — backup destination
A standalone `PersistentVolumeClaim` `eloup-backups`, `ReadWriteOnce`,
`storageClassName: linode-block-storage-retain`, `resources.requests.storage:
1Gi` (party-scale DB is tiny; a week of dumps is KB–MB). Standalone (not a
StatefulSet volumeClaimTemplate) so the CronJob owns it independently of the app.

### 2. `cronjob-backup.yaml` — the nightly job
- `schedule: "0 3 * * *"` (03:00 UTC nightly). `concurrencyPolicy: Forbid`,
  `startingDeadlineSeconds: 3600`, `successfulJobsHistoryLimit: 3`,
  `failedJobsHistoryLimit: 3`.
- **Online backup (WAL-safe):** run
  `sqlite3 /data/eloup.sqlite ".backup /backups/eloup-$(date -u +%Y%m%dT%H%M%SZ).sqlite"`.
  Use SQLite's online `.backup` (the backup API) — NOT `cp` (which can copy a
  torn file mid-write under WAL).
- **Integrity gate:** after the dump, run
  `sqlite3 <dumpfile> "PRAGMA integrity_check;"` and fail the job (non-zero exit)
  if it isn't `ok`, so a corrupt backup is loud, not silent.
- **Retention:** keep the newest 7 `eloup-*.sqlite` in `/backups`, delete older
  (`ls -1t /backups/eloup-*.sqlite | tail -n +8 | xargs -r rm -f`).
- `restartPolicy: OnFailure`.

### 3. Volume mounts (the key constraint — see Risks)
The job pod mounts BOTH:
- `data-eloup-web-0` (the app's PVC) at `/data` **read-only**, and
- `eloup-backups` at `/backups` read-write.

`data-eloup-web-0` is `ReadWriteOnce`. Linode's CSI treats RWO as *single-node*
(multiple pods on the SAME node may mount it), NOT `ReadWriteOncePod`. So the job
MUST be co-scheduled onto the same node as `eloup-web-0` via **podAffinity**:
```
affinity.podAffinity.requiredDuringSchedulingIgnoredDuringExecution:
  - labelSelector: matchLabels: { app: eloup-web }
    topologyKey: kubernetes.io/hostname
```
so it lands on the node holding the volume and can co-mount it.

### 4. Image
The app image (`node:20-bookworm-slim` + `better-sqlite3`) has **no `sqlite3`
CLI**. The job needs a sqlite-capable image. **Proposed:** `alpine:3.20` with the
command doing `apk add --no-cache sqlite` before the backup (pulls at runtime from
Alpine repos — acceptable in-cluster; reviewer may prefer a pinned
`sqlite3`-bearing image or a tiny purpose-built image for no-runtime-network).
Decide in review.

### 5. securityContext
Match the app: `runAsNonRoot: true`, `runAsUser: 1000`, `fsGroup: 1000` so the
backups PVC is group-owned and writable, and `/data` is readable (app writes as
uid 1000). Verify uid 1000 can read `/data/eloup.sqlite` (app runs as `node`
uid 1000 — same uid, so yes).

## Risks / things for the reviewer to verify
1. **RWO co-mount (TOP RISK):** confirm Linode CSI (`linode-block-storage`)
   permits a second pod mounting `data-eloup-web-0` on the same node while
   `eloup-web-0` holds it. If it enforces single-*pod* semantics, the co-mount
   fails and we need a different approach (e.g. a `kubectl exec` sidecar backup,
   or a sidecar container in the app pod that already has the volume). This is the
   make-or-break design point.
2. **WAL read from a read-only mount:** `.backup` opens the DB; with `/data`
   mounted `readOnly`, sqlite may fail to create the `-wal`/`-shm` it wants even
   for reading. May need `/data` mounted RW (still safe — online backup) or use
   `PRAGMA query_only`. Verify; fall back to RW mount if needed.
3. **Alpine `apk add` at runtime** needs egress to Alpine repos; if the cluster
   restricts egress, pin an image that already contains sqlite3.
4. **Restore procedure** must be documented (see below) — a backup nobody can
   restore is worthless.

## Restore procedure (tested runbook)
1. **Scale down** so nothing holds the DB:
   `kubectl -n eloup scale statefulset eloup-web --replicas=0` (wait for the pod
   to terminate — releases the RWO volume).
2. **One throwaway pod mounts BOTH PVCs** (both attach to that pod's node) —
   e.g. a `bholcombe/eloup-sqlite` pod with `data-eloup-web-0` at `/data` and
   `eloup-backups` at `/backups`. `ls -1t /backups/eloup-*.sqlite` to pick a dump.
3. **Replace + clear stale WAL:** copy the chosen dump over `/data/eloup.sqlite`,
   then `rm -f /data/eloup.sqlite-wal /data/eloup.sqlite-shm` — a leftover `-wal`
   from the old DB would replay onto the restored main file and corrupt it. Run
   `sqlite3 /data/eloup.sqlite 'PRAGMA integrity_check;'` on the restored file
   (expect `ok`) BEFORE bringing the app back.
4. Delete the throwaway pod; **scale back up**
   (`kubectl -n eloup scale statefulset eloup-web --replicas=1`); verify
   `/api/health` + leaderboards.

## Testing / verification
- `kubectl apply` (or ArgoCD sync) creates the PVC + CronJob cleanly.
- **Trigger once manually:** `kubectl -n eloup create job --from=cronjob/eloup-web-backup backup-test`
  → job Completes; a dated `eloup-*.sqlite` appears in the backups PVC and passes
  `PRAGMA integrity_check`.
- Run retention twice (create 8+ dumps) → only 7 remain.
- Manifests: `kubectl --dry-run=server` clean; no impact on the running app pod.
- No app source change; no symbol change expected (backups aren't a tracked
  property — if we add one to `architecture`, re-run `align.py lock`).

## Deploy
GitOps: commit `K8s/pvc-backups.yaml` + `K8s/cronjob-backup.yaml`, push, ArgoCD
applies. Then trigger the manual test job and confirm the first dump.

## Review gate
Edits `K8s/`, so needs an independent review report in `Agents/Review-reports/`
by a different agent than `## Author:`, referencing `ops-sqlite-backups.md`,
before implementation. The reviewer should focus on Risk #1 (RWO co-mount) and
#2 (WAL read) — these decide whether the CronJob approach is even viable.
