# Deployment

## Expectations

Single Next.js process running on Node 20 with the SQLite file on persistent storage. Target host is undecided as of project creation; the alignment lock just enforces that whatever host we pick keeps the framework and database choices in sync with `architecture`.

## Backups

Until a real host is chosen: any backup story is "copy the SQLite file." Pick a cadence and an off-host destination before the leaderboard has data anyone cares about losing.
