# bholcombe/eloup-sqlite — minimal sqlite3 CLI image for the backup CronJob.
# sqlite installed at BUILD time (no runtime egress); runs non-root (uid 1000)
# to match eloup-web's securityContext. AMD64 (matches architecture.image_arch).
FROM --platform=linux/amd64 alpine:3.20

RUN apk add --no-cache sqlite

# uid/gid 1000 so the job can read/write the app's 1000:1000-owned DB volume
# and the group-writable (fsGroup 1000) backups volume, while staying non-root.
RUN addgroup -g 1000 backup && adduser -D -u 1000 -G backup backup
USER 1000

ENTRYPOINT ["/bin/sh"]
