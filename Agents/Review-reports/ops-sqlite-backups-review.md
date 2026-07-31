# Review — OPS: Nightly SQLite backups to an in-cluster PVC

## Reviewer: claude-opus-4.8-backups-reviewer

Reviews task doc: `ops-sqlite-backups.md`
(Author: `claude-opus-4.8-backups-implementer`)

## Verdict: Approve-with-changes

The user's decisions (in-cluster PVC, nightly/keep-7, online `.backup`) are sound
and out of scope for debate. The **core CronJob-on-the-same-node design is
technically viable** — Risk #1 does NOT sink the approach. But two concrete
mechanics in the plan as written will fail at runtime and must be corrected
before implementation: the `/data` **read-only** mount (Risk #2) and `apk add`
**as a non-root uid** (image choice). Both have exact fixes below; fold them in
and no re-review is needed.

---

## Risk #1 — RWO co-mount on Linode CSI: VIABLE (approach is correct)

**Finding: Not blocking. The plan is right, with one clarification to bake in.**
Marked: Should-fix (add the reasoning + a guard to the manifest).

The plan's premise is correct. Kubernetes `ReadWriteOnce` is a **single-node**
access mode, not single-pod — multiple pods on the *same* node may mount the same
RWO PVC. `ReadWriteOncePod` (which the app PVC does **not** use — see
`K8s/statefulset-web.yaml` line 73-74, `accessModes: [ReadWriteOnce]`) is the mode
that would forbid a second pod. So the access mode permits the co-mount.

Why this is *safe* at the block-device level (the crux the task flags): the Linode
block volume is attached to exactly **one VM** and its ext4 filesystem is mounted
**once** by the kubelet at the node's global CSI staging path
(`NodeStageVolume`). Each consuming pod then receives a **bind mount** of that
single staged mount (`NodePublishVolume`). The backup pod does not independently
mount the raw block device a second time — it bind-mounts the *same already-mounted
filesystem*. There is therefore no dual-mount ext4 corruption hazard, and no second
VM attachment (so the per-instance volume-attach limit is irrelevant here). This is
the standard, supported CSI path for same-node multi-pod RWO. The Linode CSI driver
follows it; nothing Linode-specific breaks it.

The one hard requirement — co-scheduling onto the node that holds the volume — is
correctly handled by the `podAffinity` on `topologyKey: kubernetes.io/hostname`
with `labelSelector app: eloup-web`. I verified the app pods actually carry that
label (`statefulset-web.yaml` lines 16-17 `template.metadata.labels app: eloup-web`),
so the selector will match. `requiredDuringScheduling…` is the correct (hard)
choice — a soft affinity could land the job on the wrong node and fail the mount.

Clarifications to fold in (Should-fix / Optional):
- **Scheduling-race caveat (Optional, document):** if the app pod is mid-reschedule
  at 03:00 (node drain/upgrade), no pod matches the affinity and the job stays
  Pending until `startingDeadlineSeconds` (3600s) expires, then is skipped. Nightly
  cadence makes a one-night miss acceptable — just note it so a skipped job on an
  upgrade night isn't mistaken for a bug.
- **The alternative if this were RWOPod:** for the record, had the app PVC been
  `ReadWriteOncePod` the correct fallback would be a **sidecar container inside the
  app StatefulSet pod** (shares the already-mounted volume, runs `.backup` on a
  timer) — NOT ReadWriteMany (Linode block storage cannot do RWX; only NFS/object
  can, and RWX+SQLite advisory locking over NFS is unsafe). We do **not** need that
  fallback here, but state it so the design rationale is auditable.

---

## Risk #2 — WAL read from a read-only `/data` mount: the plan is WRONG as written

**Finding: Blocking as written (readOnly). Fix: mount `/data` read-WRITE.**

Confirmed WAL: `eloup-web/lib/db/client.ts` line 10, `handle.pragma('journal_mode
= WAL')`. So the live DB runs in WAL mode.

Opening a WAL-mode database requires access to the `-shm` shared-memory index. A
second OS process (the sqlite3 CLI) opening the DB must be able to **map and write
`/data/eloup.sqlite-shm`** to join the WAL coordination — it cannot use pure
read-only shared-memory mode when a read-write connection (the app) is live. With
`/data` bind-mounted `readOnly`, the CLI cannot touch `-shm`/`-wal` and
`.backup` will fail to open the source (typically `SQLITE_READONLY` /
"unable to open database file" / "attempt to write a readonly database"). The
plan's own Risk #2 suspects this; I'm resolving it definitively:

**Mount `/data` read-WRITE** in the backup pod. This is safe and correct:
- Two processes on the **same host sharing the same filesystem mount** is exactly
  the scenario SQLite's POSIX advisory locking + WAL `-shm` are designed for. (This
  is *also* why the same-node co-mount from Risk #1 is the right topology — it keeps
  locking on a single kernel, unlike an RWX/NFS spread which would break it.)
- The online `.backup` API takes a read snapshot; the app keeps writing concurrently
  and the destination file is a consistent point-in-time copy. Cross-process
  consistency holds because both connections coordinate through the shared `-wal`/
  `-shm` on the same mount.
- **No last-connection surprise:** the app connection stays open continuously, so
  when the CLI process exits it is never the "last connection" — SQLite will not
  fire a close-time checkpoint that truncates/removes the live `-wal`. The app's WAL
  is left intact.
- A passive checkpoint the reader may trigger is harmless and lock-coordinated.

Do NOT rely on `PRAGMA query_only` to make readOnly work — it governs write
*statements*, not the `-shm` mapping requirement, so it does not fix the open.

Note on `fsGroup` interaction: with `/data` read-write and pod `fsGroup: 1000`,
the kubelet may attempt an ownership reconcile on the volume; since the app already
owns the files `1000:1000` this is a no-op. (With a readOnly mount `fsGroup` is
skipped — another reason readOnly is the awkward path.)

---

## Correctness details

### Image / `apk add sqlite` at runtime — Blocking
Two independent problems with `alpine:3.20` + `apk add --no-cache sqlite` in the
job command:
1. **`apk add` requires root.** The pod is (correctly) specified `runAsNonRoot:
   true, runAsUser: 1000`. `apk add` must write `/etc/apk`, `/lib`, `/usr/bin` —
   all root-owned — so it will fail with permission errors as uid 1000. You cannot
   both `runAsNonRoot` and `apk add` in the same container. Dropping to root to
   install would violate the security posture the task itself sets.
2. **Runtime network dependency.** Even as root, every nightly run pulls from the
   Alpine CDN; a mirror hiccup or any egress policy turns a backup into a silent
   failure. Backups must not depend on external package repos at run time.

**Fix (required):** use an image that **already contains the `sqlite3` CLI**,
pinned by digest. Options, in order of preference:
- Build a tiny purpose image `bholcombe/eloup-sqlite` (`FROM alpine:3.20` +
  `RUN apk add --no-cache sqlite` at **build** time, non-root at runtime), pushed to
  the same registry — matches project image conventions and needs zero runtime
  egress. Best for reproducibility and the security posture.
- Or a maintained public sqlite image pinned by digest (e.g. `keinos/sqlite3`,
  `nouchka/sqlite3`) if you accept an external dependency.
Whichever: pin by digest, not a floating tag, so a backup can't silently change
sqlite versions.

### securityContext uid 1000 / fsGroup — Correct
Verified: `eloup-web/Dockerfile` line 40 `USER node` (the node base image's
uid/gid 1000), and `statefulset-web.yaml` lines 60-62 `runAsUser: 1000` + line 20
`fsGroup: 1000`. So `/data/eloup.sqlite` is owned `1000:1000`; a backup pod running
as uid 1000 can read **and** write it (write is now required per Risk #2). Pod-level
`fsGroup: 1000` makes the `eloup-backups` PVC group-writable. The task's claim here
is accurate. Keep `runAsNonRoot: true` — which is precisely why the `apk add` image
choice above must change.

### `date`-stamped filename — Correct
`eloup-$(date -u +%Y%m%dT%H%M%SZ).sqlite` → e.g. `eloup-20260731T030000Z.sqlite`.
`$(date)` expands in the shell before `sqlite3` runs, so the path is literal. Format
is colon-free (ext4-safe), UTC, and lexicographically sortable. Nightly cadence makes
same-second collisions impossible. Fine.

### Retention `ls -1t … | tail -n +8 | xargs -r rm -f` — Correct math, minor fragility
`ls -1t` = newest-first by mtime; `tail -n +8` emits the 8th-newest onward; deleting
those keeps the 7 newest (including tonight's) → matches "keep last 7." Good.
- Confirm BusyBox `xargs` in the chosen image supports `-r` (Alpine's busybox
  usually does). If unsure, guard with `[ -n "$(ls …)" ]` or `find`-based deletion
  instead of parsing `ls`. (Should-fix — robustness, not a math error.)
- Wrap the script in `set -euo pipefail` so a failed dump/integrity step aborts
  *before* retention runs — you never want to prune old good backups after a failed
  new one. (Should-fix.)

### integrity_check gate — Correct, tighten the assertion
Running `PRAGMA integrity_check` on the **dump file** (not the live DB) is the right
target — it validates the artifact you'll restore from. The script must **explicitly
assert the output equals `ok`** and exit non-zero otherwise (a plain
`sqlite3 … "PRAGMA integrity_check;"` exits 0 even when it prints error rows), e.g.
`[ "$(sqlite3 "$f" 'PRAGMA integrity_check;')" = "ok" ]`. (Should-fix — make the gate
real, not decorative.)

---

## Missing / to add for a correct, safe MVP

- **No manual WAL checkpoint needed (affirming a good choice).** The online
  `.backup` API writes a fully self-contained destination DB reflecting the reader's
  snapshot (committed WAL frames included); the dump has no companion `-wal`. So you
  do **not** need to checkpoint first, and you do **not** back up `-wal` separately —
  unlike a `cp`-based scheme. The task's choice of `.backup` over `cp` is correct and
  is what makes this safe. (Confirmation, no change.)
- **Restore procedure — correct on the crucial point, one clarification.** Deleting
  the stale `-wal`/`-shm` before/after dropping the restored file in place (step 3) is
  **essential and correct**: a leftover `-wal` from the old DB would be replayed on
  top of the restored main file → corruption. Good catch. Clarify step 2-3: to copy
  between two RWO PVCs you need **one** throwaway pod mounting **both**
  `eloup-backups` and `data-eloup-web-0` (both attach to that single pod's node), or
  use `kubectl cp`. Also run `integrity_check` on the restored file before scaling
  back up. (Should-fix — precision in the runbook.)
- **Job hardening (Should-fix):** set `backoffLimit` (e.g. 2) and
  `activeDeadlineSeconds` on the Job spec so a hung `.backup` can't hold a read lock
  indefinitely, plus modest `resources.requests/limits` on the job pod.
- **Same-failure-domain limitation is clearly stated (adequate).** The task
  explicitly scopes out offsite/region loss and names the Object Storage v2 follow-up.
  Worth making explicit that both PVCs are Linode block volumes in the same region
  (us-sea-2) — same failure domain — so this protects against logical damage (bad
  DELETE, corruption, app bug), not infrastructure loss. Ensure `pvc-backups.yaml`
  uses `linode-block-storage-retain` (task says it does) so deleting the PVC won't
  nuke history, and sits in `namespace: eloup`.

---

## Summary of required changes (fold in, then implement)

Blocking:
1. Mount `/data` **read-write**, not readOnly (Risk #2) — WAL open needs `-shm`.
2. Use a **prebuilt, digest-pinned image containing `sqlite3`** — drop
   `apk add` at runtime (fails as uid 1000 + runtime-egress fragility).

Should-fix:
3. Bake the Risk #1 rationale + accept the scheduling-race caveat; keep the hard
   `podAffinity` (verified selector matches `app: eloup-web`).
4. `set -euo pipefail`; assert `integrity_check` == `ok`; verify BusyBox `xargs -r`
   or use a `find`-based prune.
5. Add `backoffLimit` / `activeDeadlineSeconds` / job resources.
6. Tighten the restore runbook (single pod mounting both PVCs / `kubectl cp`;
   integrity-check the restored file).

The design's spine — CronJob co-scheduled via podAffinity, RWO same-node
bind-mount, online `.backup`, integrity gate, keep-7 retention — is sound. With the
two Blocking fixes it is safe to ship.
