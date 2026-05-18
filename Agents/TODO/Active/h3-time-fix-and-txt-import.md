# H3 — Race time display fix + TXT import support

## Author: claude-opus-4.7-h3-implementer
## Status: Complete

> **Reviewer findings folded in (2026-05-17).** See
> `Agents/Review-reports/h3-time-fix-and-txt-import-review.md`
> (claude-sonnet-4-6-h3-reviewer, APPROVE-WITH-CHANGES). Material
> deltas baked into the sections below:
>
> - **Summary-table skip uses regex** `/\|\s*Laps\s*\|/i` instead of a
>   literal `| Laps |` string match — the fixture has `| Laps  |`
>   (two spaces) and a literal match silently fails on every real
>   export. (MAJOR #6 / #1 in the recommended-follow-ups list.)
> - **Driver OR-query is deterministic via `ORDER BY CASE`** —
>   `ORDER BY CASE WHEN lap_monitor_driver_uuid = ? THEN 0 ELSE 1 END
>   LIMIT 1`, so the UUID match always wins over the name match when
>   both branches could fire. (MAJOR #1 / #1 in follow-ups.)
> - **Conditional `upsertDriver` fallback** — confirmed `conditional`
>   per Q2: case-insensitive `display_name` match only fires when the
>   existing row's `lap_monitor_driver_uuid` starts with `txt-name:`.
>   JSON-only flows stay correct; TXT-then-JSON dedups. (Q2 / strengths
>   in the report.)
> - **Full month names pinned by test.** A non-May test
>   (`2026-01-15T08:30:00Z` → `January 15, 2026, 8:30 AM`) locks in the
>   choice so a future refactor to short names trips the test. (NIT #8
>   / Q3.)
> - **`app/racing/upload/page.tsx` copy** added to change-site list —
>   lines 27 and 47 say "JSON or TXT" after the edit. (MINOR #2.)
> - **`source_blob = text`** explicitly documented for the TXT path
>   (mirrors `JSON.stringify(race)` on the JSON side). (MINOR #3.)
> - **Body schema uses `z.discriminatedUnion` on `format`** —
>   `format: 'json' | 'txt'` is the explicit discriminant, removing
>   the `z.union` left-to-right ambiguity. The form sends the matching
>   literal. (MINOR #4.)
> - **Hand-offs note** added for the TXT-then-JSON UUID-loss case —
>   when a TXT-created row dedups against a later JSON, the real
>   Lap Monitor UUID is NOT backfilled; admin tool needed if the
>   operator wants to associate the row with the device identity.
>   (MINOR #5.)
> - **Scripting-consumer caveat** added — client-side format sniff
>   means a curl consumer must set `format: 'json' | 'txt'`
>   explicitly. (Q1.)

> Two related hotfixes to the RC racing surface:
>
> 1. **Race times render in the recorded local time**, not UTC-shifted.
>    The pod runs `TZ=UTC`; `toLocaleString(undefined, ...)` on the
>    server formats the parsed `Date` in the pod's local zone (UTC),
>    which collapses every offset to UTC and shows a 09:51 PDT race as
>    "4:51 PM". The stored ISO is correct (offset preserved); only the
>    display layer is wrong. Fix: slice ISO components directly and
>    format from them, no `toLocaleString`, no `Date` math.
> 2. **Lap Monitor's TXT export imports through the same pipeline as
>    JSON.** The operator already uploads JSON; they now also have TXT
>    files (a human-readable export of the same race). Add a TXT parser
>    that maps to the same intermediate shape the JSON importer feeds
>    into `rc_races` / `rc_drivers` / `rc_race_drivers` / `rc_laps`,
>    branch on content-sniffing inside the upload route, and extend the
>    upload form's `accept` to `.json,.txt`.
>
> **Author/Reviewer separation note.** Prior implementer agents include
> `claude-opus-4.7-{planner,m2,m3,m4,m5,h1,r1,h2}-implementer`; prior
> reviewers include `claude-sonnet-4-6-{m2,m3,m4,m5,h1,r1,h2}-reviewer`
> (plus an early `claude-sonnet-4-6-reviewer`). The reviewer for this
> doc must use a `## Reviewer:` field distinct from
> `## Author: claude-opus-4.7-h3-implementer`. Suggested:
> `claude-sonnet-4-6-h3-reviewer`.
>
> The reviewer should land their report at
> `Agents/Review-reports/h3-time-fix-and-txt-import-review.md`
> referencing `h3-time-fix-and-txt-import.md` in the body. Until then,
> the review gate blocks edits to `eloup-web/`.

---

## Why this task exists

### The time bug

R1 introduced ISO timestamps stored verbatim from the Lap Monitor JSON
(e.g. `2026-05-03T09:51:32-07:00`). The display layer uses
`new Date(iso).toLocaleString(undefined, {...})` to format. On a
laptop dev box (TZ=America/Los_Angeles) this happens to render
"9:51 AM" — the same wall-clock the operator raced at. **In
production**, the pod runs with `TZ=UTC`. `toLocaleString(undefined, ...)`
formats in the host's zone (UTC), which translates the `-07:00` offset
forward to UTC, and the page renders "4:51 PM". The DB row is right;
the display is wrong; the bug is invisible in local dev.

The fix is to **stop normalizing to a host-local zone at all**. The
RC operator records races at a single venue; the recorded local time
is the time they care about. Slicing the ISO string components
preserves that time across SSR (UTC pod), CSR (whatever the visitor's
zone happens to be), and dev (laptop in any zone).

### The TXT format

Lap Monitor exports a human-readable TXT alongside the JSON:

```
R2

Race    May 17, 2026 at 2:54:26 PM

 Timing data provided by LapMonitor lap counting system (https://lapmonitor.com)


    Driver     | Laps  |    Time    |  Best Lap
=================================================
Sean           |    20 |    5:00.47 |    0:13.03
Brandon        |    20 |    5:10.70 |    0:12.88


Sean:
Lap     0:             0:07.41
Lap     1:   0:15.23   0:22.64
...
```

The TXT carries enough information to reconstruct the same `rc_*` rows
as the JSON, with two caveats:

- **No race UUID, no driver UUIDs.** Idempotency and driver dedup need
  synthetic equivalents.
- **No timezone offset** on the race date. The TXT writes
  "May 17, 2026 at 2:54:26 PM" with no zone label; we store it
  offset-less (a floating local timestamp) and rely on the Phase A
  helper to render it back verbatim.

The operator wants `/racing/upload` to accept both formats — same
admin gate, same surface, same insertion pipeline.

---

## Operator decisions (locked in)

| # | Question | Decision | Why |
|---|---|---|---|
| Q-H3-1 | Date format | **`May 3, 2026, 9:51 AM`** — no timezone suffix. 12-hour AM/PM. | Matches the TXT export's own date row. No zone label because everything an operator sees was recorded in the same place — labelling adds noise. |
| Q-H3-2 | TXT idempotency key | **SHA-1 of normalized file content, prefixed with `txt:`. Stored in the existing `lap_monitor_uuid` column.** | Reuses the UNIQUE constraint on `rc_races.lap_monitor_uuid`; no schema change. Normalize = strip trailing whitespace per line + collapse blank-line runs to one. Stable across `\r\n` / `\n` and trailing-whitespace noise. |
| Q-H3-3 | Driver dedup across JSON + TXT | **Case-insensitive `display_name` match against `rc_drivers`. On miss, insert with `lap_monitor_driver_uuid = txt-name:<lowercased-name>`.** | Acceptable risk: "Brandon Smith" and "Brandon Jones" collapse to one row if names aren't distinct. Flagged in Hand-offs as the trigger for a future driver-merge admin tool. |
| Q-H3-4 | Whole-file-fatal on malformed TXT? | **Yes — same policy as the JSON importer.** | Lap timing IS the point. A malformed lap line is a real ingestion failure; partial-import is worse than no-import. Return `{status: 'invalid', reason}`. |
| Q-H3-5 | TXT race kind enum | **`Race` → `race`, `Practice` → `practice`, `Qualif` → `qualif`** (case-insensitive prefix match). Anything else → `invalid`. | Mirrors the existing `rc_races.race_kind` CHECK / zod enum. |
| Q-H3-6 | TXT `duration_seconds` | **`null`** — TXT doesn't expose race duration. | JSON has `duration`; TXT doesn't; we drop the constraint at the DB layer (column is nullable). |
| Q-H3-7 | TXT `transponder_id` | **`0`** — TXT has no transponder column. | Tiebreak still works (transponder_id ASC). With 0 for every TXT-imported driver in a race, ties fall to insert order, which is the order they appear in the TXT — the same order Lap Monitor's summary table renders. |
| Q-H3-8 | API content sniffing | **First non-blank char of the request body: `{` → JSON, else → TXT.** | One unambiguous discriminant. The body now has to be parsed as text first, then branched, instead of `req.json()` directly. |
| Q-H3-9 | Upload form `accept` | **`.json,.txt`** plus updated placeholder copy ("Upload Lap Monitor JSON or TXT"). | The form already file-reads to text; the same text-pipe works for both. |
| Q-H3-10 | Phase A helper signature | **`formatRecordedDate(iso) → "May 3, 2026, 9:51 AM"`** and `formatRecordedDateOnly(iso) → "May 3, 2026"`. Invalid input returns the input verbatim. | Two callers want date-only (the list view), three want date+time (race detail, driver profile recent races, track best-laps). Two helpers, one shared format-month-name primitive. |

---

## Files I'll change

Under `eloup-web/`:

| File | Status | Change |
|---|---|---|
| `lib/rc/datetime.ts` | new | `formatRecordedDate(iso): string` and `formatRecordedDateOnly(iso): string`. Slice ISO components (year, month, day, hour, minute) without constructing a `Date`. Idempotent across SSR/CSR. |
| `lib/rc/import-txt.ts` | new | Pure parser. Converts TXT to the same intermediate shape `lib/rc/import.ts` uses (or close enough to share the insertion pipeline). Exports `importLapMonitorTxt(db, text, trackId, uploadedBy, now?) → ImportResult`. Reuses the `ImportResult` / `ImportSummary` types from `lib/rc/import.ts` (export them if not already exported). |
| `app/racing/[raceId]/page.tsx` | edit | Replace local `formatDateTime` with `formatRecordedDate` from `lib/rc/datetime.ts`. Drop the local helper. |
| `app/racing/page.tsx` | edit | Replace local `formatDate` with `formatRecordedDate`. Drop the local helper. |
| `app/racing/drivers/[driverId]/page.tsx` | edit | Replace local `formatDate` with `formatRecordedDateOnly` (driver profile lists dates without times). |
| `app/racing/tracks/[slug]/page.tsx` | edit | Replace local `formatDate` with `formatRecordedDateOnly`. |
| `app/api/racing/import/route.ts` | edit | Read body as text. Sniff: first non-blank char `{` → JSON path (existing zod body shape); else → TXT path (new). Maintain the same auth + 401/403/400 envelope. Both paths must accept `trackId` or `newTrackName`. For TXT, those come as multipart-style form fields? — see Phase C below; we keep the JSON body shape and send the TXT as a string under a `text` field. |
| `components/RcUploadForm.tsx` | edit | `<input type="file" accept=".json,.txt">`. Label / placeholder copy update. On submit, sniff the user-pasted-or-uploaded text and send either `{format: 'json', json: parsed}` or `{format: 'txt', text}` as the POST body. |
| `app/racing/upload/page.tsx` | edit | Copy: "Sign in to upload Lap Monitor JSON." → "Sign in to upload Lap Monitor JSON or TXT." Line 47 "Paste or upload the Lap Monitor JSON export..." → "...JSON or TXT export...". |
| `tests/unit/rc-datetime.test.ts` | new | `formatRecordedDate` happy paths (offset, Z, no offset, midnight, noon, 12:00 AM). `formatRecordedDateOnly` happy paths. Invalid input returns input verbatim. |
| `tests/unit/rc-import-txt.test.ts` | new | TXT parser unit tests: fixture round-trip, malformed lap line rejection, missing driver section rejection, empty file rejection, lap-time parser (`M:SS.HH` → ms), `txt:` UUID stability across whitespace normalization, race-kind dispatch. |
| `tests/integration/rc-import-txt.test.ts` | new | Full-fixture round-trip via `importLapMonitorTxt`: row counts (1 race, 2 drivers, 42 laps), lap_time_ms magnitudes (Sean lap 1 = 15230 ms, Brandon lap 15 = 28960 ms), re-upload returns duplicate, TXT-then-JSON driver dedup, JSON-then-TXT driver dedup. |

Out of `eloup-web/`: no symbol changes (`racing` symbol stays as it
is — display-driven, admin-uploaded, anonymous-readable; format
plurality is a code-level concern), no wizard changes, no docs
changes.

---

## Phase A — Time fix (`lib/rc/datetime.ts`)

### Signature

```ts
// Render a race-recorded ISO timestamp as the local time it was
// recorded in, NOT shifted to the server's timezone. The production
// pod runs as TZ=UTC; using toLocaleString(undefined) would translate
// the stored offset to UTC and show 4:51 PM for a 9:51 AM PDT race.
// We slice the ISO components directly to preserve recorded time.
export function formatRecordedDate(iso: string): string;
export function formatRecordedDateOnly(iso: string): string;
```

### Accepted shapes

- `2026-05-03T09:51:32-07:00` → `May 3, 2026, 9:51 AM`
- `2026-05-03T09:51:32+00:00` → `May 3, 2026, 9:51 AM`
- `2026-05-03T09:51:32Z` → `May 3, 2026, 9:51 AM`
- `2026-05-03T09:51:32` (offset-less; TXT-imported) → `May 3, 2026, 9:51 AM`
- `2026-05-03T00:00:00Z` → `May 3, 2026, 12:00 AM`
- `2026-05-03T12:00:00Z` → `May 3, 2026, 12:00 PM`
- Invalid (no `T`, garbage, empty) → return the input verbatim (defensive)

### Implementation sketch

```ts
// lib/rc/datetime.ts
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function formatRecordedDate(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  const monthIdx = Number(mo) - 1;
  if (monthIdx < 0 || monthIdx > 11) return iso;
  const monthName = MONTHS[monthIdx]!;
  const dayNum = Number(d);
  const yearNum = Number(y);
  const hourNum = Number(h);
  const period = hourNum >= 12 ? 'PM' : 'AM';
  const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12;
  return `${monthName} ${dayNum}, ${yearNum}, ${hour12}:${mi} ${period}`;
}

export function formatRecordedDateOnly(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const monthIdx = Number(mo) - 1;
  if (monthIdx < 0 || monthIdx > 11) return iso;
  return `${MONTHS[monthIdx]!} ${Number(d)}, ${y}`;
}
```

Notes:

- **No `Date`** at any point. Constructing a `Date` triggers offset
  translation; we want the raw recorded wall-clock.
- Month names are shortened to "Jan", "Feb", ... in the format example
  `May 3, 2026` — but May is already 3 letters and the example uses
  the full month spelling for May. I'll go with the full month name
  for unambiguity ("May 3" works either way; "Jan 3" vs "January 3" is
  a stylistic choice — picking full names so longer months don't get
  truncated). If the reviewer prefers short names (`May`, `Aug`,
  `Sept`), I'll switch — it's a one-line change.
- The ISO regex is permissive on seconds + fractional seconds + offset
  to accept the JSON shape (`-07:00`), the TXT-derived shape
  (offset-less), and any reasonable variant. It rejects shapes without
  a `T` separator (date-only) because the helpers expect a full
  timestamp; pure date strings are handled by `formatRecordedDateOnly`
  which uses the same regex (date components only).

### Replacement sites

- `app/racing/[raceId]/page.tsx:69` — `formatDateTime` → `formatRecordedDate`
- `app/racing/[raceId]/page.tsx:265-275` — delete the local helper
- `app/racing/page.tsx:80` — `formatDate` → `formatRecordedDate`
  (the list view DOES include time today: "May 3, 2026, 9:51 AM" — kept)
- `app/racing/page.tsx:105-115` — delete the local helper
- `app/racing/drivers/[driverId]/page.tsx:99` — `formatDate` → `formatRecordedDateOnly`
  (the driver profile lists dates without times today: `d.toLocaleDateString()`)
- `app/racing/drivers/[driverId]/page.tsx:117-120` — delete the local helper
- `app/racing/tracks/[slug]/page.tsx:57` — `formatDate` → `formatRecordedDateOnly`
  (the track best-lap leaderboard uses date-only as a fallback for unnamed races)
- `app/racing/tracks/[slug]/page.tsx:68-71` — delete the local helper

---

## Phase B — TXT importer (`lib/rc/import-txt.ts`)

### Signature

```ts
import type Database from 'better-sqlite3';
import type { ImportResult } from './import';

export function importLapMonitorTxt(
  db: Database.Database,
  text: string,
  trackId: string,
  uploadedBy: string,
  now: () => string = () => new Date().toISOString(),
): ImportResult;
```

Returns the same `ImportResult` shape as `importLapMonitorJson` so the
upload route can branch on format up front and uniformly handle the
result.

### Parse phases

1. **Header**: first non-blank line is `race_name` (e.g. `R2`).
2. **Date row**: next non-blank line. Format:
   ```
   <Kind>\s+<Month> <Day>, <Year> at <H>:<MM>:<SS> <AM|PM>
   ```
   `<Kind>` ∈ `{Race, Practice, Qualif}` (case-insensitive). Parse to
   an offset-less ISO string like `2026-05-17T14:54:26`. The 24-hour
   conversion follows: `12 AM → 00`, `12 PM → 12`, `1-11 AM → 01-11`,
   `1-11 PM → 13-23`. Reject if format doesn't match.
3. **Skip the attribution line** containing `lapmonitor.com` (and the
   blank line after).
4. **Skip the summary table**: detect the header line by the regex
   `/\|\s*Laps\s*\|/i` (the fixture's actual header is
   `| Laps  |` with two spaces — a literal `| Laps |` match silently
   fails). Then skip the `===...` separator and the data rows (one per
   driver) until we hit a blank line.
5. **Per-driver sections**: each begins with `<DriverName>:` on its
   own line. The name is what's before the trailing colon, stripped
   of whitespace. Following lines are lap entries:
   ```
   Lap\s+(\d+):\s+([\d:.]+)\s+([\d:.]+)   # normal: lap + cumulative
   Lap\s+0:\s+([\d:.]+)                    # initial: cumulative only
   ```
   End of a driver section is a blank line, EOF, or the next driver
   header (a non-`Lap`-prefixed line ending with `:`).

### Lap-time parsing

```ts
// "0:15.23" → 15230 ms; "5:10.70" → 310700 ms
// Format: [M]M:SS.HH (HH = hundredths of a second).
function parseLapTimeMs(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\.(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, mins, secs, hh] = m;
  return Number(mins) * 60_000 + Number(secs) * 1000 + Number(hh) * 10;
}
```

The `* 10` mirrors the JSON importer's `LAP_MONITOR_CS_TO_MS = 10` —
both formats encode hundredths of a second.

### Intermediate shape

The parser produces an in-memory structure shaped like a single race
in the JSON importer's `RaceSchema` (minus the UUIDs):

```ts
type ParsedDriver = {
  name: string;
  laps: Array<{
    kind: 'initial' | 'normal';
    lapTimeMs: number;       // 0 for the initial cumulative-only lap
    endTimestampMs: number;  // cumulative
    userIndex: number;       // 0-indexed within driver section
  }>;
};

type ParsedRace = {
  raceName: string;
  raceKind: 'race' | 'practice' | 'qualif';
  raceStartedAt: string;     // offset-less ISO
  drivers: ParsedDriver[];
};
```

Note: TXT has no `ignored` lap kind. Every non-zero lap line is
`normal`; lap 0 is `initial`.

### Mapping to the insertion pipeline

We can either:

- **Option A**: Convert `ParsedRace` to the JSON importer's intermediate
  type and call `importLapMonitorJson` with the converted shape.
- **Option B**: Inline the SQL inserts in `import-txt.ts` mirroring
  `importLapMonitorJson` body.

Option A means dragging the JSON parser's zod schemas around for a
shape we already control. Option B means duplicating ~50 lines of SQL.

**Picking Option B**, but factoring the shared SQL plumbing into a
small helper module so neither importer drifts. Specifically, extract
`insertRaceRow`, `upsertDriverByUuid`, `insertRaceDrivers`, and
`insertLaps` to `lib/rc/import-common.ts` (new), and consume from
both. This is a refactor of `import.ts`; review the cross-commit
dependency carefully. (If the reviewer prefers Option A, I'll switch
— but Option B keeps each importer's parse logic standalone and
testable.)

### Driver dedup logic (TXT side)

```ts
// 1. Compute the synthetic UUID for this driver: txt-name:<lower>.
// 2. Look up rc_drivers WHERE lap_monitor_driver_uuid = synthetic
//    OR lower(display_name) = lower(name). The display-name match
//    catches a driver who first appeared in a JSON import (real UUID)
//    and is now appearing in a TXT import (no UUID).
// 3. On hit, reuse the row; don't overwrite the existing
//    lap_monitor_driver_uuid (it stays as the original).
// 4. On miss, insert a new rc_drivers row with the synthetic UUID.
```

The SQL (deterministic — UUID match always wins when both branches
could fire):

```sql
SELECT id FROM rc_drivers
 WHERE lap_monitor_driver_uuid = ?            -- the synthetic txt-name:<lower>
    OR lower(display_name) = lower(?)         -- the raw name
 ORDER BY CASE WHEN lap_monitor_driver_uuid = ? THEN 0 ELSE 1 END
 LIMIT 1
```

The synthetic UUID is bound twice: once for the WHERE, once for the
ORDER BY. When the OR-match wins, the existing driver row's
`lap_monitor_driver_uuid` is unchanged (could be a real UUID from a
JSON import, or another `txt-name:<lower>` from an earlier TXT). The
contract is: one driver row per case-insensitive name, regardless of
which format created it.

### Idempotency

Compute the synthetic key once for the whole file:

```ts
function normalizeForHash(text: string): string {
  // Strip trailing whitespace per line; collapse runs of blank lines
  // to one blank line. Normalises \r\n / \n.
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ''));
  const out: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    const blank = line.length === 0;
    if (blank && prevBlank) continue;
    out.push(line);
    prevBlank = blank;
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

function txtHash(text: string): string {
  return `txt:${createHash('sha1').update(normalizeForHash(text)).digest('hex')}`;
}
```

Store as `rc_races.lap_monitor_uuid`. The existing UNIQUE constraint
catches duplicate uploads.

### Whole-file-fatal validation

Any of the following produces `{status: 'invalid', reason}` without
inserting any rows:

- Empty file (after trim).
- Missing header line.
- Missing or malformed date row (kind not in the enum; date doesn't
  match the regex).
- Zero driver sections.
- Any lap line that doesn't match the `Lap\s+\d+: ...` regex inside a
  driver section.
- Any cumulative or lap-time string that fails `parseLapTimeMs`.
- A driver section with zero lap entries.

Errors are wrapped in the same `ImportResult.invalid` shape as the JSON
importer.

### Transaction

The whole insert happens in a single `db.transaction(() => {...}).immediate()`
— same pattern as `importLapMonitorJson`. If the file's already
imported (UNIQUE collision on `lap_monitor_uuid`), we bail before
inserting; if any per-row insert fails mid-flight (shouldn't happen
once parse succeeds, but defensively), the whole insert rolls back.

### Standings derivation

Same `comparePlacement` logic as `importLapMonitorJson`: `laps DESC,
totalTime ASC, transponder ASC`. Transponder is 0 for every TXT
driver, so the tiebreaker is effectively insert order, which matches
the TXT's own summary-table order.

---

## Phase C — Upload UI + API plumbing

### `app/api/racing/import/route.ts`

```ts
// Read body once as text.
const raw = await req.text();
const firstNonBlank = raw.replace(/^\s+/, '').charAt(0);

if (firstNonBlank === '{') {
  // JSON path: existing zod body shape.
  const parsed = Body.safeParse(JSON.parse(raw));
  // ... existing logic.
} else {
  // TXT path: body is the request JSON { trackId? | newTrackName?, text }.
  // But we just consumed the body as raw text. So actually the form
  // POSTs application/json with shape { trackId? | newTrackName?, text }
  // for both branches, and the discriminant is the SHAPE of that JSON:
  // does the JSON contain a `json` field (→ JSON branch) or a `text`
  // field (→ TXT branch)? — see below.
}
```

**Picked approach**: Both branches go through `application/json`
content-type with a discriminated-union body shape that explicitly
tags the format. Per MINOR #4: `z.union` is left-to-right and silently
accepts ambiguous bodies; `z.discriminatedUnion` on an explicit
`format` literal is unambiguous and self-documenting:

```ts
const Body = z.discriminatedUnion('format', [
  z.object({
    format: z.literal('json'),
    trackId: z.string().min(1).optional(),
    newTrackName: z.string().min(1).max(120).optional(),
    json: z.unknown(),
  }),
  z.object({
    format: z.literal('txt'),
    trackId: z.string().min(1).optional(),
    newTrackName: z.string().min(1).max(120).optional(),
    text: z.string().min(1),
  }),
]);
```

Branch on `parsed.data.format`. Scripting consumers (curl, etc.)
MUST set the literal explicitly — there is no server-side sniff.

This makes content sniffing the **client's** job (which already knows
which format the user picked) and keeps the server-side discrimination
clean and zod-checked. The "first non-blank char" sniff happens in the
**client form** to decide which payload shape to POST.

(If the reviewer prefers server-side sniffing on raw text, I'll
switch; the tradeoff is a slightly more flexible API at the cost of
the zod discriminant. Picking discriminated bodies because (a) the
form already has both code paths and (b) the API stays simple and
self-documenting for the scripting use case in R1's Q-R1-4.)

### `components/RcUploadForm.tsx`

- `<input type="file" accept=".json,.txt">`.
- Legend: "Lap Monitor JSON or TXT".
- Placeholder copy in the textarea: changes based on the sniffed
  format (or just keep the JSON-shaped placeholder; the TXT pasted in
  is human-readable enough to recognize without a placeholder hint).
- On submit, sniff the textarea content's first non-blank char:
  `{` → POST `{format: 'json', trackId | newTrackName, json: JSON.parse(text)}`;
  else → POST `{format: 'txt', trackId | newTrackName, text}`. The
  JSON parse stays only on the JSON branch (TXT can't be JSON-parsed
  and shouldn't be).
- 44px tap targets preserved on every interactive control.

---

## Phase D — Tests

Aim for ~18 new tests. Vitest, same harness as the rest of `tests/`.

### Unit (`tests/unit/`)

`rc-datetime.test.ts` (new, ~7 tests):
- `formatRecordedDate` with offset: `2026-05-03T09:51:32-07:00` → `May 3, 2026, 9:51 AM`.
- `formatRecordedDate` with Z: `2026-05-03T09:51:32Z` → `May 3, 2026, 9:51 AM`.
- **Non-May month (pins full-name choice, NIT #8):**
  `formatRecordedDate('2026-01-15T08:30:00Z')` → `January 15, 2026, 8:30 AM`.
- `formatRecordedDate` offset-less: `2026-05-03T09:51:32` → `May 3, 2026, 9:51 AM`.
- `formatRecordedDate` midnight: `2026-05-03T00:00:00Z` → `May 3, 2026, 12:00 AM`.
- `formatRecordedDate` noon: `2026-05-03T12:00:00Z` → `May 3, 2026, 12:00 PM`.
- `formatRecordedDate` invalid: `"garbage"` → `"garbage"` verbatim.
- `formatRecordedDateOnly` with offset: `2026-05-03T09:51:32-07:00` → `May 3, 2026`.
- `formatRecordedDateOnly` invalid: `"hi"` → `"hi"`.
- Server-zone independence: a test that sets `process.env.TZ = 'UTC'`,
  then sets `process.env.TZ = 'America/Los_Angeles'`, and asserts
  `formatRecordedDate` returns the same string in both cases for the
  same input. (Covers the regression — the whole point.)

`rc-import-txt.test.ts` (new, ~10 tests):
- `parseLapTimeMs('0:15.23') === 15230`.
- `parseLapTimeMs('5:10.70') === 310700`.
- `parseLapTimeMs('15:00.00') === 900000`.
- `parseLapTimeMs('0:0.0') === null` (malformed — needs `MM` and `HH` exactly).
- Fixture-text parse: assert race_name `R2`, race_kind `race`,
  raceStartedAt `2026-05-17T14:54:26`, two drivers (Sean, Brandon),
  Sean has 21 laps (Lap 0..20), Brandon has 21 laps, Sean lap 1
  lapTimeMs = 15230.
- Malformed lap line ("Lap 1: bogus 0:22.64") → `invalid`.
- Missing date row ("R2\n\nSean:\nLap 0: 0:07.41\n") → `invalid`.
- Empty file → `invalid`.
- Zero driver sections → `invalid`.
- `txt:` hash stability: same fixture with `\r\n` vs `\n`, trailing
  spaces, and one extra blank line between drivers → same hash.

### Integration (`tests/integration/`)

`rc-import-txt.test.ts` (new, ~6 tests):
- Full fixture import: returns ok, summary
  `{totalRaces: 1, insertedRaces: 1, duplicateRaces: 0, driversCreated: 2,
   driversReused: 0, lapsImported: 42}`. Asserts `rc_races` count = 1
  with race_name `R2`, race_kind `race`, race_started_at
  `2026-05-17T14:54:26`. Two `rc_drivers` rows; their
  `lap_monitor_driver_uuid` values start with `txt-name:`. Forty-two
  `rc_laps` rows; Sean lap 1 lap_time_ms = 15230; Brandon lap 15
  lap_time_ms = 28960.
- Re-uploading the same fixture: returns ok, summary
  `{totalRaces: 1, insertedRaces: 0, duplicateRaces: 1, ...}`. No new
  rows.
- JSON-then-TXT driver dedup: import the JSON fixture (creates a
  driver row with `lap_monitor_driver_uuid = F8CFF97C-...`,
  `display_name = 'Brandon'`); then import the TXT fixture (same
  "Brandon"); assert ONE `rc_drivers` row with `display_name =
  'Brandon'`, its `lap_monitor_driver_uuid` unchanged from the JSON
  import.
- TXT-then-JSON driver dedup: import TXT first (creates
  `lap_monitor_driver_uuid = txt-name:brandon`); then import JSON
  (real UUID `F8CFF97C-...`); assert ONE `rc_drivers` row. Existing
  JSON-importer logic uses `lap_monitor_driver_uuid` for lookup, so
  this case is the harder one — the JSON importer won't find an
  existing UUID match (the synthetic key differs from the JSON
  UUID), and will INSERT a second row. **Resolution**: extend
  `upsertDriver` in `lib/rc/import.ts` to fall back on case-insensitive
  `display_name` match before INSERT, mirroring the TXT side. Tested
  by this integration case. (Cross-commit dependency: this lives in
  commit 4, not commit 3.)
- Standings ordering with transponder=0: import TXT; assert Sean's
  placement = 1 (faster total_time_ms) and Brandon's placement = 2.
- Whole-file-fatal on malformed: a TXT with a corrupted lap line in
  driver 2 → `invalid`, no `rc_races` row inserted, no `rc_drivers`
  rows added (even if driver 1 parsed fine).

### Edits to existing tests

- `tests/unit/rc-stats.test.ts`, `tests/integration/rc-import.test.ts`,
  `tests/integration/rc-admin-edits.test.ts`: skim for any
  `formatDateTime` / `formatDate` assertions that now need to match
  the new format. Expect zero hits — these tests look at row data,
  not rendered strings.

### Test count

~9 unit + ~6 integration = ~15 new tests, plus the cross-format dedup
test (counted in the integration set). Edits to existing tests: 0
expected; if any surface, they're trivial format-string updates.

---

## Three must-work flows

### Flow 1 — Time display fix (anonymous viewer)

An anonymous visitor on production opens `/racing/<raceId>` for a race
recorded at 09:51 PDT. The page header shows
`Started: May 3, 2026, 9:51 AM` (the time the operator raced) — NOT
`May 3, 2026, 4:51 PM` (UTC translation). The same race's row on
`/racing` and on `/racing/drivers/<driverId>` shows the same recorded
local time. The pod's `TZ=UTC` no longer affects display.

### Flow 2 — TXT upload happy path

An admin opens `/racing/upload`, picks an existing track from the
dropdown, clicks the file picker, selects the operator's TXT export
(the `Agents/fixtures/lap-monitor-sample.txt` shape), submits. The
client sniffs the leading `R` (not `{`), POSTs
`{trackId, text: '<the txt>'}` to `/api/racing/import`. The server
branches to `importLapMonitorTxt`, inserts:
- 1 `rc_races` row (`race_name = 'R2'`, `race_kind = 'race'`,
  `race_started_at = '2026-05-17T14:54:26'`,
  `lap_monitor_uuid = 'txt:<sha1>'`, `duration_seconds = null`).
- 2 `rc_drivers` rows (Sean + Brandon, `lap_monitor_driver_uuid`
  values `txt-name:sean` and `txt-name:brandon`).
- 2 `rc_race_drivers` rows with placement, laps_completed,
  best_lap_ms, total_time_ms derived from the parsed laps.
- 42 `rc_laps` rows (2 × 21 — lap 0 through lap 20).

The form shows the same success summary as the JSON path.

### Flow 3 — Idempotency on re-upload

The admin re-uploads the same TXT file. The client computes the
synthetic `txt:<sha1>`; the server inserts nothing
(`duplicateRaces = 1, insertedRaces = 0`); summary echoes back.
Re-uploading the same file after stripping trailing whitespace from
one line, or after `dos2unix`, still dedupes (the hash is computed on
normalized content).

### Flow 4 — Mixed-format driver dedup

The admin imports the JSON fixture (drivers Brandon `F8CFF97C-...`
and Willy `...`), then imports a TXT containing "Brandon" and a new
driver "Sean". The final state: ONE `rc_drivers` row for Brandon
(reused from JSON; `lap_monitor_driver_uuid = F8CFF97C-...`), ONE
new row for Sean (`lap_monitor_driver_uuid = txt-name:sean`), and
the existing Willy row (unchanged). Reversed order (TXT first, then
JSON) → still ONE Brandon row at the end. The JSON-importer's
`upsertDriver` gains a fallback case-insensitive `display_name`
match before INSERT to handle the "TXT first" path.

---

## Out of scope for H3 (do NOT build)

- CSV / Excel / other Lap Monitor exports. **TXT only.**
- Live timing / streaming ingest.
- Driver-rename / driver-merge UI. The case-insensitive name dedup
  is a known compromise (see Hand-offs).
- Lap-number editing (admin tooling).
- Wizard changes.
- ELO integration (R2 territory).
- Timezone label on the rendered date. The format is intentionally
  zone-less.
- Per-driver penalty editing for TXT-imported races — H2's penalty
  feature works on any race regardless of import format; no extra
  work needed.
- Audit log of imports (the `source_blob` column preserves the raw
  TXT, mirroring the JSON's preservation). **Per MINOR #3**:
  `source_blob = text` (the full raw TXT string verbatim — not a
  parsed representation) on the TXT path, mirroring
  `JSON.stringify(race)` on the JSON path.

---

## Quality bar (same as M1–R1, H1, H2)

- No comments unless WHY is non-obvious. The "TXT has no offset; we
  store as floating local" semantic is the kind of thing worth one
  comment in `import-txt.ts`. The "no `Date` to avoid TZ math" rationale
  is worth one comment in `datetime.ts`.
- No mocks at the DB boundary. Ephemeral SQLite per integration test
  via the existing `mkdtempSync`/`applyMigrations` harness.
- TypeScript strict; no `any` without a `// reason:` line.
- ESLint + Prettier + typecheck + build clean.
- Mobile-first: the upload form's 44px tap target is preserved on the
  file input + textarea + submit.

---

## Verification

After implementation lands (commits 3 + 4):

1. `python3 scripts/align.py check` exits 0. No symbol change — H3
   doesn't add new symbols and doesn't change `racing` properties.
2. `cd wizard && python3 -m pytest -q` — still passes (104 expected).
3. `cd eloup-web && pnpm test && pnpm lint && pnpm typecheck && pnpm build`
   clean.
4. `docker build -f Dockerfile.eloup-web .` succeeds.
5. **Do NOT run the wizard. Do NOT push to remote. Do NOT call any
   prod API.** The operator handles deploy after implementation is
   reviewed and merged.

---

## Commit shape

Four implementer commits mirroring H2:

1. `docs: H3 — time fix + TXT import task doc` — this file only.
   **STOP after this commit and request review.**
2. `docs: H3 — reviewer report` — landed by a different agent in
   `Agents/Review-reports/h3-time-fix-and-txt-import-review.md`
   referencing this filename.
3. `feat: eloup-web — render races in recorded local time` — Phase A
   only. `lib/rc/datetime.ts` + replacements in the four racing pages
   + unit tests.
4. `feat: eloup-web — TXT import for Lap Monitor exports` — Phase B
   + C. `lib/rc/import-txt.ts`, optional `lib/rc/import-common.ts`
   refactor, route branching, upload form changes, unit + integration
   tests. Includes the small `upsertDriver` extension in
   `lib/rc/import.ts` for cross-format name dedup.

Optional commit 5: `docs: H3 — mark task Complete` once verification
passes.

Each commit ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Hand-offs

After H3 ships, the following follow-ups are natural but deferred:

- **TXT-then-JSON: real Lap Monitor UUID is not backfilled.** When a
  TXT creates a driver row with `lap_monitor_driver_uuid =
  'txt-name:brandon'` and a subsequent JSON for the same driver runs
  the conditional fallback, the row is correctly reused but the JSON's
  real UUID (`F8CFF97C-...`) is NOT written into
  `rc_drivers.lap_monitor_driver_uuid`. The row retains
  `txt-name:brandon`. If the operator later wants to associate that
  row with the real Lap Monitor device identity, a manual admin fix
  is needed. Captured here per MINOR #5; a follow-up admin tool would
  resolve.
- **Scripting consumers.** The format discriminant is client-side —
  the API requires `format: 'json' | 'txt'` on the body. A curl
  consumer must set the literal explicitly; no raw-body sniff happens
  server-side. This is documented per Q1.
- **Driver-merge admin tool.** TXT imports use case-insensitive name
  matching, which collapses "Brandon Smith" and "Brandon Jones" — a
  real risk at parties with multiple Brandons. A small
  `/racing/admin/drivers` page with a "merge driver A into driver B"
  operation (re-points `rc_race_drivers.driver_id` + `rc_laps.driver_id`
  + nulls out the orphaned row's `lap_monitor_driver_uuid`) is the
  natural fix. Out of scope here.
- **Driver-rename admin tool.** Companion to merge — set
  `rc_drivers.display_name` post-hoc. Trivial to add; deferred so we
  don't bundle it into H3.
- **R2 (RC ELO)** consumes whatever ends up in `rc_*` tables — TXT
  vs JSON origin doesn't matter once the row is in. R2 should
  document that `transponder_id = 0` is sentinel for "unknown
  transponder" and not treat 0 as a real ID.
- **Timezone-aware display** for tournament admins who run sims at
  multiple venues. If the operator ever travels and runs a race at
  a different venue, the `formatRecordedDate` helper preserves
  recorded-local but doesn't label the zone — confusing if a future
  multi-venue dashboard surfaces. Out of scope here; flag for the
  consumer.

---

## Clarifying questions surfaced while writing this doc

Flagging for the reviewer to weigh in on before implementation
starts:

1. **Server-side TXT sniffing vs client-side?** I picked client-side
   (the form sniffs and tags the JSON body with `json` or `text`).
   Pros: server stays simple, zod schema discriminates cleanly, no
   ambiguity if someone POSTs a TXT that happens to start with `{`.
   Cons: a scripting consumer (the R1 Q-R1-4 API use case) has to
   pre-tag their body too. Server-side sniffing (read raw text,
   branch on first non-blank char) would let curl users POST raw
   TXT bodies. I lean **client-side** because the form is the
   primary use case and the zod boundary is cleaner. Switchable in
   ~10 lines.

2. **Should `importLapMonitorJson`'s `upsertDriver` gain the
   case-insensitive name fallback?** I wrote the spec saying yes
   (so TXT-then-JSON dedups). Question: does this risk wrong
   merges in pure-JSON-only flows? Example: a Lap Monitor JSON
   that has both "Brandon" the racer and a fresh new "Brandon" the
   newcomer — under the current schema they'd both have unique
   `driverUuid`s so the JSON importer would correctly create two
   rows. With my proposed fallback, the second JSON import would
   match by name and reuse the first Brandon's row, **silently
   merging two unrelated drivers**. The fallback is therefore
   strictly worse for pure-JSON workflows. **Alternative**: only
   apply the case-insensitive fallback when the existing row's
   `lap_monitor_driver_uuid` starts with `txt-name:` (signalling
   "we don't actually know who this is"). That way JSON-only
   stays correct AND TXT-then-JSON dedups. I'd prefer this; please
   confirm.

3. **Month name format.** I picked full month names (`May`,
   `January`, ...) instead of short (`May`, `Jan`, ...). The
   example in the spec used `May 3, 2026, 9:51 AM` — May is 3
   letters either way. If the reviewer prefers short names for the
   non-`May` months, I'll switch.

4. **`duration_seconds` for TXT races.** I picked `null` since TXT
   doesn't expose it. The R1 schema has `duration_seconds INTEGER`
   without NOT NULL, so nullable is fine. If a downstream consumer
   relies on the field being non-null (R2?), they need a check; I
   don't think any current consumer does.

5. **TXT files with `\r\n` line endings.** The normalize-for-hash
   step splits on `/\r?\n/`, so the hash is `\r\n`-stable. The
   parser also splits on `/\r?\n/` so parsing is unaffected by
   line endings. Worth a unit test (covered in the test plan).

6. **What about an empty driver section in the TXT?** A row like
   `Sean:` followed immediately by another driver header or EOF
   with no Lap lines. Spec'd as `invalid` (whole-file-fatal). If
   the operator legitimately wants to record "Sean entered the
   race but completed zero laps", they need the JSON path (which
   has `kind: 'initial'` representing it). Flagging — I don't
   expect this in practice.
