# Review: h3-time-fix-and-txt-import.md

## Reviewer: claude-sonnet-4-6-h3-reviewer
## Date: 2026-05-17
## Verdict: APPROVE-WITH-CHANGES

## Summary

The H3 plan is well-reasoned and technically correct on its core claims. Phase A's ISO-slicing approach eliminates the TZ=UTC display bug cleanly, and the TXT parser spec maps accurately to the real fixture format. Two issues require resolution before commit 3 begins: the `upsertDriver` conditional fallback's SQL `LIMIT 1` without `ORDER BY` is non-deterministic when both match conditions could theoretically fire against different rows, and the upload page at `app/racing/upload/page.tsx` has hardcoded "JSON"-only copy that the plan does not list as a change site. The remaining findings are minor or cosmetic.

---

## Issues found

**1. [MAJOR] `upsertDriver` OR-query `LIMIT 1` is non-deterministic without an `ORDER BY`**

The TXT importer's driver-lookup SQL is:

```sql
SELECT id FROM rc_drivers
 WHERE lap_monitor_driver_uuid = ?   -- synthetic txt-name:<lower>
    OR lower(display_name) = lower(?)
 LIMIT 1
```

SQLite's `LIMIT 1` without `ORDER BY` returns an arbitrary row when both `WHERE` branches could match distinct rows. In practice, the dedup invariants should prevent two `rc_drivers` rows where one has `lap_monitor_driver_uuid = 'txt-name:brandon'` AND another has `display_name = 'brandon'`, but the contract should not rely on that invariant holding under all orderings and race conditions. Add `ORDER BY CASE WHEN lap_monitor_driver_uuid = ? THEN 0 ELSE 1 END LIMIT 1` to prefer the UUID match over the name match deterministically. This also makes the query self-documenting: UUID match takes precedence, name match is the fallback.

**2. [MINOR] `app/racing/upload/page.tsx` copy is not listed as a change site but contains JSON-only text**

The plan lists `components/RcUploadForm.tsx` (legend, placeholder) as the copy update site. It does not list `app/racing/upload/page.tsx`. However, that page has two JSON-only strings that will be stale after TXT support ships:

- Line 27: `"Sign in to upload Lap Monitor JSON."` (the unauthenticated state message)
- Line 47: `"Paste or upload the Lap Monitor JSON export..."` (the authenticated state description)

These are user-visible at a party. Add both lines to commit 4's scope.

**3. [MINOR] `import-txt.ts` source_blob value is not explicitly specified**

The plan mentions "the `source_blob` column preserves the raw TXT, mirroring the JSON's preservation" in the Out-of-scope section. In `import.ts`, `source_blob` stores `JSON.stringify(race)` — the per-race JSON object. For TXT there is no per-race JSON object; the plan implies storing the raw TXT string, but does not state this explicitly in Phase B. Clarify in the Phase B `insertRaceRow` spec: `source_blob = <the full raw TXT string>`. This also confirms the column's type (`TEXT`) handles it without a schema change.

**4. [MINOR] `z.union` body schema is ambiguous when a POST body contains both `json` and `text` fields**

The plan's API branch uses:

```ts
const Body = z.union([
  z.object({ ..., json: z.unknown() }),
  z.object({ ..., text: z.string().min(1) }),
]);
```

`z.union` tries schemas left to right and takes the first match. A body containing both `json` and `text` fields silently takes the JSON path (the `json: z.unknown()` schema accepts any shape that has `json` present, regardless of extra fields). This could mask a client bug. Use `z.discriminatedUnion` on an explicit literal `format: 'json' | 'txt'` field, or — simpler and more robust — after parsing with the union, check `'text' in parsed.data` as the runtime discriminant instead of relying on zod to discriminate. Either way the current spec is ambiguous and should be tightened.

**5. [MINOR] TXT-then-JSON: the JSON driver's real Lap Monitor UUID is silently lost**

When a TXT is imported first (creating `lap_monitor_driver_uuid = 'txt-name:brandon'`) and then a JSON is imported for the same driver (UUID `F8CFF97C-...`), the conditional fallback correctly finds and reuses the existing row but does NOT update `lap_monitor_driver_uuid` to the real UUID. This means `F8CFF97C-...` is never persisted. A subsequent JSON for the same driver hits the conditional fallback again (still works), but the real UUID is permanently absent from the DB. This is an information-loss trade-off. The plan should document it explicitly in Hand-offs as: "After TXT-then-JSON dedup, the real Lap Monitor driver UUID is not backfilled into `rc_drivers`. If the operator later wants to associate the row with a real UUID (e.g. for device-identity purposes), a manual admin fix is needed." Currently this is only implied, not stated.

**6. [MINOR] Summary table skip heuristic uses `| Laps |` but the actual fixture has `| Laps  |`**

Phase B step 4 says "skip the summary table: the header line containing `| Laps |`". Verified against the fixture:

```
    Driver     | Laps  |    Time    |  Best Lap
```

The actual string is `| Laps  |` (two spaces), not `| Laps |` (one space). A literal string match on `| Laps |` would fail to detect the summary table header. The implementer should use a regex like `/\|\s*Laps\s*\|/` or strip/normalize whitespace before matching. This is a parser correctness issue that would cause the parser to enter the summary table rows as driver sections, fail on `|`-containing lines as non-lap lines, and return `invalid`.

**7. [NIT] `formatRecordedDateOnly` rejects date-only strings (no `T`) — inconsistent with the helper's name**

The plan's `ISO_RE` requires a `T` separator and captures hour/minute components. `formatRecordedDateOnly` uses the same regex but only reads `y`, `mo`, `d`. This means `formatRecordedDateOnly('2026-05-03')` returns the input verbatim instead of `"May 3, 2026"`, even though the function name implies it accepts dates in any reasonable form. The plan's own example in Q-H3-10 lists `formatRecordedDateOnly(iso) → "May 3, 2026"` suggesting the input is always a full ISO timestamp with `T`, not a date-only string. If that invariant holds, it's fine — but add a brief comment: "Expects a full ISO timestamp with `T`; date-only strings are not supported and return verbatim." This prevents a future caller from incorrectly passing a date-only string.

**8. [NIT] Month-name format choice should be confirmed in the test**

The plan picks full month names (`January`, `February`, ...) and notes "if the reviewer prefers short names, I'll switch." Confirmed: use **full month names**. The operator-facing date in the TXT fixture itself uses full names (`May 17, 2026`), and consistency with the source format is the right default. Pin this in a test assertion for a non-May month (e.g. `2026-01-15T08:30:00Z` → `January 15, 2026, 8:30 AM`) so the choice is permanently verifiable and a future refactor to short names would surface a test failure.

---

## Coverage check

- [x] `lib/rc/datetime.ts` — `formatRecordedDate` + `formatRecordedDateOnly`, ISO slicing, no `Date`
- [x] `lib/rc/import-txt.ts` — TXT parser, `importLapMonitorTxt` signature + return type
- [x] `lib/rc/import-common.ts` (optional) — factored SQL helpers shared between importers
- [x] `lib/rc/import.ts` — `upsertDriver` conditional fallback for TXT-then-JSON dedup
- [x] `app/racing/[raceId]/page.tsx` — `formatDateTime` → `formatRecordedDate`, local helper removed
- [x] `app/racing/page.tsx` — `formatDate` → `formatRecordedDate`, local helper removed
- [x] `app/racing/drivers/[driverId]/page.tsx` — `formatDate` → `formatRecordedDateOnly`, local helper removed
- [x] `app/racing/tracks/[slug]/page.tsx` — `formatDate` → `formatRecordedDateOnly`, local helper removed
- [x] `app/api/racing/import/route.ts` — body read as text, JSON/TXT branch, auth unchanged
- [x] `components/RcUploadForm.tsx` — `accept=".json,.txt"`, format sniff on submit, legend copy
- [ ] `app/racing/upload/page.tsx` — JSON-only copy not listed as change site (gap — see finding 2)
- [x] TXT idempotency via SHA-1 normalized hash with `txt:` prefix in `lap_monitor_uuid`
- [x] Driver dedup: synthetic `txt-name:<lower>` UUID, OR-query for cross-format match
- [x] `upsertDriver` conditional fallback: only when existing UUID starts with `txt-name:`
- [x] `tests/unit/rc-datetime.test.ts` — happy paths including Z, offset, offset-less, midnight, noon, TZ-independence
- [x] `tests/unit/rc-import-txt.test.ts` — parser unit tests including fixture round-trip, malformed cases, hash stability
- [x] `tests/integration/rc-import-txt.test.ts` — full fixture import, re-upload dedup, JSON-then-TXT, TXT-then-JSON, standings ordering, whole-file-fatal
- [ ] OR-query `ORDER BY` for deterministic driver match (gap — see finding 1)
- [ ] `source_blob` value for TXT races explicitly documented (gap — see finding 3)
- [ ] `z.union` vs `z.discriminatedUnion` ambiguity resolved (gap — see finding 4)
- [ ] TXT-then-JSON UUID loss documented in Hand-offs (gap — see finding 5)
- [ ] Summary table skip heuristic uses correct whitespace-tolerant match (gap — see finding 6)
- [ ] Non-May month pinned in a test assertion (gap — see finding 8)

---

## Strengths worth keeping

- **No `Date` at any point in Phase A.** The ISO-slicing approach is exactly the right fix. Confirmed against the fixture: `2026-05-03T09:51:32-07:00` → the regex captures `09`, `51` directly; no zone math possible. The TZ-independence test (TZ=UTC then TZ=America/Los_Angeles, same output) is the correct regression anchor.

- **Whole-file-fatal policy carried consistently to TXT.** Matches the JSON importer's policy (documented in `import.ts` line 64 comment). Partial TXT import would be worse than no import given race timing is the core data. The plan is right to hold the same line.

- **`normalizeForHash` is precise.** The three-step normalization (strip trailing whitespace, collapse blank-line runs, trailing-newline normalize) covers the exact portability problems the operator faces (`\r\n` from Windows exports, trailing spaces from copy-paste). The hash is stable across those transformations while still distinct for content changes.

- **Conditional `upsertDriver` fallback is the right policy for Q2.** The conditional form (only when the existing row's UUID starts with `txt-name:`) correctly handles JSON-only workflows: two distinct JSON Brandons with different UUIDs are never merged. Only the "this row was created from a TXT and therefore has no real UUID" case triggers the name fallback. This is the correct trade-off and the implementer's recommended choice is confirmed.

- **Commit split (3 = time fix only, 4 = TXT importer) is clean.** Phase A is independently useful, testable, and safe to deploy before Phase B lands. The cross-commit dependency (the `upsertDriver` extension goes in commit 4, not 3) is correctly placed — commit 3's tests will pass without the TXT dedup logic.

---

## Positions on the flagged clarifying questions

1. **Server-side vs client-side TXT sniffing (Q1):** Client-side discrimination (plan's choice) is correct for the primary use case, but the plan should also support server-side sniffing for scripting consumers. Recommend: accept both. The route should check `'text' in body` after union parse (or a discriminated union on a `format` field). If the caller is a curl script, they can set `format: 'txt'` explicitly. The form always sets the right field. This is lower-friction than requiring curl users to know the schema. If implementation complexity is a concern, keep client-side only and document the constraint in the API comments — but flag it in Hand-offs for R2 scripting consumers.

2. **Driver dedup fallback — conditional vs unconditional (Q2):** **Conditional.** The implementer's analysis is correct. UNCONDITIONAL name fallback silently merges two legitimately distinct JSON drivers who share a first name (real-world risk at parties). CONDITIONAL (only when existing row's UUID starts with `txt-name:`) is strictly safer and requires no additional complexity. Confirmed: use the conditional form. The TXT-then-JSON test case in the integration suite will validate it.

3. **Month name format — full vs short (Q3):** **Full month names.** The TXT fixture itself uses `May 17, 2026` with the full name. Operator-facing copy should be consistent with the source format. Longer months (`January`, `September`) are unambiguous; `Jan` vs `Jan.` vs `January` is a source of future churn. Lock in full names and pin with a test for a non-May month (see finding 8).

4. **`duration_seconds = null` for TXT races (Q4):** Confirmed correct. The column is nullable; no current consumer enforces non-null. R2 should be notified in Hand-offs (already present) that `duration_seconds = null` is a sentinel for TXT-origin races. The existing `rc_races` schema (`duration_seconds INTEGER` without `NOT NULL`) supports this without migration.

5. **TXT `\r\n` line endings (Q5):** The normalization step splits on `/\r?\n/` — confirmed correct for both hash stability and parsing. Add the `\r\n`-stability test to `rc-import-txt.test.ts` (the plan includes it; good). No action needed beyond what the plan already specifies.

6. **Empty driver section (Q6):** **`invalid` is correct.** An empty driver section (header with no lap lines before next header or EOF) is whole-file-fatal. A driver with zero laps completed is a real data-quality problem, not a normal operating state. The JSON path handles zero-lap drivers because the JSON importer processes whatever laps array it receives (including empty), but the TXT parser should be strict: any `DriverName:` header must be followed by at least one `Lap N:` line. This protects against a malformed TXT where a truncated copy-paste includes a driver header with no laps.

---

## Recommended follow-ups for the implementer

1. **[Finding 1 — MAJOR]** Add `ORDER BY CASE WHEN lap_monitor_driver_uuid = ? THEN 0 ELSE 1 END LIMIT 1` to the TXT importer's driver OR-query (passing the synthetic UUID twice: once for the WHERE and once for the ORDER BY). This makes UUID-match take priority over name-match and eliminates non-determinism.

2. **[Finding 6 — MAJOR]** Fix the summary table skip heuristic to use whitespace-tolerant matching. Replace the literal `| Laps |` check with a regex `/\|\s*Laps\s*\|/i` (or strip spaces before comparing). Verify against the fixture: `    Driver     | Laps  |    Time    |  Best Lap` — the actual separator is `| Laps  |` (two spaces). A failing heuristic here would silently produce `invalid` on every real TXT export.

3. **[Finding 2 — MINOR]** Add `app/racing/upload/page.tsx` to commit 4's scope. Update lines 27 and 47 to say "JSON or TXT" instead of "JSON". Also update the button label text in the unauthenticated view.

4. **[Finding 4 — MINOR]** Tighten the body schema discriminant. Options (pick one): (a) use `z.discriminatedUnion('format', [z.object({ format: z.literal('json'), ... }), z.object({ format: z.literal('txt'), ... })])` and update `RcUploadForm.tsx` to send `format: 'json'` or `format: 'txt'`; (b) after parsing with `z.union`, use `'text' in parsed.data` as the runtime discriminant and treat a body with both `json` AND `text` as an error. Option (b) is smaller. Add a test: body with both fields → 400.

5. **[Finding 3 — MINOR]** Explicitly state in Phase B's `insertRaceRow` spec: `source_blob = text` (the full raw TXT string, not a parsed representation). This is implicit but should be documented alongside the JSON importer's `source_blob = JSON.stringify(race)`.

6. **[Finding 5 — MINOR]** Add to Hand-offs: "In the TXT-then-JSON import order, the JSON driver's real Lap Monitor UUID (`F8CFF97C-...`) is not backfilled into `rc_drivers.lap_monitor_driver_uuid` after dedup. The row retains `txt-name:<lower>`. A future admin tool that links `rc_drivers` rows to Lap Monitor device identities will need to handle this case."

7. **[Finding 8 — NIT]** Add a `formatRecordedDate('2026-01-15T08:30:00Z') === 'January 15, 2026, 8:30 AM'` test to `rc-datetime.test.ts`. This pins the full-month-name decision and catches any future refactor to short names.
