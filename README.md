# eloup

Multi-game ELO tracking website for parties.

Players log in, record results across multiple game types, and watch their per-game ratings move. The aggregate cross-game leaderboard is a derived view on top of per-game ELO.

## Stack

- Next.js (App Router) on Node 20
- SQLite via `better-sqlite3`
- Per-player login; results are confirmed by all participants before they affect ratings

See [`symbols/manifest.json`](symbols/manifest.json) for the full set of decisions and [`docs/`](docs/) for context on each.

## Project state

This repository uses a [symbolic alignment](https://haxley.luckyenough.us/Brandonw.h2o/baseline) scaffold: typed symbols in `manifest.json` describe project state, and `manifest.lock` is a hash tree CI verifies. Run `python scripts/align.py status` to check alignment.

## Building it

The actual app is not in this repo yet — what's checked in is the project scaffold and the decisions that frame the build. Next steps live in `Agents/TODO/`.
