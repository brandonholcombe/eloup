# Deployment

## Target

Shared Linode LKE cluster `tow-c1` in region `us-sea-2`, alongside captain-sonar, shine, and other Kodloki apps. The wizard talks to the cluster via the operator's mounted kubeconfig; it does not provision the cluster itself.

| Field              | Value                                       |
|--------------------|---------------------------------------------|
| Host               | `eloup.kodloki.io` (A → `172.232.176.47`)   |
| Namespace          | `eloup`                                     |
| Ingress class      | `nginx` (shared controller)                  |
| ClusterIssuer      | `letsencrypt-prod` (cert-manager)            |
| Storage class      | `linode-block-storage-retain` (5 Gi PVC)     |
| Image prefix       | `bholcombe/eloup-` on DockerHub              |
| GitOps archetype   | shine flat (`K8s/*.yaml`, single namespace)  |
| Canonical remote   | GitHub (`brandonholcombe/eloup`)             |
| Mirror remote      | Gitea (`brandonw.h2o/eloup` on `haxley.luckyenough.us`) |

## Wizard

Packaged as `bholcombe/eloup-wizard:latest` (AMD64), run locally via `docker run -it`. It mounts the operator's kubeconfig and a host-side state directory (`~/.config/eloup-wizard/`) so progress survives container exits. Phases are idempotent and resumable; phases with multiple external side effects (repo creation, dual-remote push) track per-substep status so a crash between two API calls resumes at the right step rather than re-running the whole phase.

## DNS

DNS for `kodloki.io` is hosted at Linode (no wildcard A record). The wizard creates the per-app A record (`eloup.kodloki.io → 172.232.176.47`) via the Linode DNS API using the operator's Linode PAT. Idempotent — skips if already correct. `--skip-dns` opts out so the operator can manage DNS out-of-band.

## Backups

Until a real backup story is wired up: any backup is "copy the SQLite file off the PVC." The retain reclaim policy on the storage class is the first line of defence — the PVC survives namespace deletion. A nightly file copy to S3-compatible storage is the post-MVP plan (Q-ARCH-2).
