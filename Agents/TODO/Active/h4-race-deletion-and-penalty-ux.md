# H4 — Race deletion + penalty UX hint

## Author: claude-opus-4.7-h4-implementer
## Status: In Progress

## Reviewer notes folded in (post-review, 2026-05-17)

The reviewer (`claude-sonnet-4-6-h4-reviewer`) returned
**APPROVE-WITH-CHANGES** (2 MAJOR, 4 MINOR, 2 NIT). Findings folded
into the plan below before implementation:

- **[MAJOR #1] `placement` field drop is non-breaking — documented.**
  No existing HTTP caller reads `placement` from the PATCH penalty
  response: `RaceAdminPanel.tsx`'s `PenaltyRow` calls
  `router.refresh()` only and never inspects the response body
  beyond `error`; existing tests call `setDriverPenalty` /
  `standingsForRace` at the lib boundary, not via HTTP. Dropping the
  `placement` field in favour of `placement_before` +
  `placement_after` therefore breaks zero callers. The Phase B API
  route notes carry this conclusion explicitly.
- **[MAJOR #2] Delete button uses `useTransition` + `disabled={pending}`.**
  The component spec below now requires the same in-flight guard
  pattern that `TrackChangeForm` and `PenaltyRow` already use. On
  click: `start(async () => { ... })`; button `disabled` is
  `!matches || pending`.
- **[MINOR #3] Confirmation input cleared on non-204 error.**
  Spec calls out resetting `confirm` state to `''` on any
  non-success response, preventing a click-without-retype after a
  401/403/404.
- **[MINOR #4] `router.refresh()` after `router.push('/racing')`.**
  Pattern: `router.push('/racing'); router.refresh();` — busts the
  App Router client cache so the list page does not briefly show
  the deleted race.
- **[MINOR #5] `placement_before === null` guard is intentional.**
  When `standingsForRace` returns no row for the driver (test edge
  case only), both `_before` and `_after` are `null`; the
  `typeof === 'number'` guards in the client suppress the hint
  correctly. Documented inline at the route.
- **[MINOR #6] Test 7 captures BEFORE count, not vacuous AFTER.**
  Cross-race isolation test now uses
  `const before = countFor(raceB); deleteRace(raceA);
  expect(countFor(raceB)).toBe(before);` so the assertion can never
  pass on an empty fixture.
- **[NIT #7] Danger-zone `<hr>` separator made explicit.**
  Component spec mentions `border-t border-red-900/30` so the
  implementer does not have to invent it.
- **[NIT #8] Penalty hint bumped from `text-[10px]` to `text-xs`.**
  Actionable feedback matches the `text-xs text-red-400` error
  styling already used in `PenaltyRow`.

### Reviewer's positions on the 5 flagged clarifying questions

1. **Q1 — case sensitivity:** case-insensitive trim match (matches
   the default).
2. **Q2 — length cap on confirmation:** no cap; truncating the
   match target would let any prefix through. Skip.
3. **Q3 — DELETE response:** 204 no-body (matches the default).
4. **Q4 — hint re-show on repeated saves:** allow re-show; each
   save communicates its own outcome.
5. **Q5 — stale page for second admin:** acceptable for now,
   already flagged in Hand-offs.

> Two small admin-side additions to the RC racing surface, both
> extending H2's `RaceAdminPanel`:
>
> 1. **Hard-delete a race.** Operator needs to remove duplicate or
>    mistaken-entry races. Cascade FKs are already in place
>    (`rc_race_drivers.race_id` and `rc_laps.race_id` both
>    `ON DELETE CASCADE` per `0003_rc_racing.sql:38,52`), so one
>    `DELETE FROM rc_races WHERE id = ?` clears the race and all its
>    dependent rows. `source_blob` goes with the row — irreversible.
> 2. **Penalty UX hint.** When the admin saves a penalty that does
>    NOT shift the driver's placement (because the placement was
>    locked in by `laps_completed` ordering rather than time), surface
>    a small inline hint so the operator can tell the save worked.
>    The placement-recompute logic stays exactly as H2 shipped it —
>    laps DESC, adjusted-total ASC, transponder ASC — because that
>    matches the importer's `comparePlacement` and the future
>    fixed-lap-race use case. This is a UX nudge, NOT a semantics
>    change.
>
> **Author/Reviewer separation note.** Prior implementer agents are
> `claude-opus-4.7-{planner,m2,m3,m4,m5,h1,r1,h2,h3}-implementer`;
> prior reviewers are
> `claude-sonnet-4-6-{m2,m3,m4,m5,h1,r1,h2,h3}-reviewer` (plus the
> early `claude-sonnet-4-6-reviewer`). The reviewer for this doc
> must use a `## Reviewer:` field distinct from
> `## Author: claude-opus-4.7-h4-implementer`. Suggested:
> `claude-sonnet-4-6-h4-reviewer` (matches prior convention).
>
> The reviewer should land their report at
> `Agents/Review-reports/h4-race-deletion-and-penalty-ux-review.md`
> referencing `h4-race-deletion-and-penalty-ux.md` in the body. Until
> then, the review gate blocks edits to `eloup-web/`.

---

## Why this task exists

H2 shipped `RaceAdminPanel` with track reassignment + per-driver
penalties. Two follow-ups surfaced from the operator's first session
applying penalties at a real event:

1. **No way to delete a race.** A test JSON uploaded during setup, a
   duplicate from a mistaken re-upload onto a different track, or a
   practice session that shouldn't have been counted — none of these
   are removable today. The only recovery is a manual
   `DELETE FROM rc_races WHERE id = ?` in the pod, which is friction
   the operator (and any future operator) shouldn't bear. The cascade
   FKs make this a single-statement operation; the UX cost (admin
   confirmation gate) is the only real work.

2. **Penalty saves look like no-ops when the placement doesn't move.**
   The current placement-recompute ordering is `laps_completed DESC,
   adjusted_total_time_ms ASC, transponder_id ASC`. Suppose Driver A
   completed 21 laps and Driver B completed 20 laps, A's total is
   330s, B's is 290s. The admin (correctly believing B was faster on
   a lap basis) applies a 5s penalty to A. A's adjusted total goes
   from 330s → 335s, but A still has more laps than B, so A keeps
   placement 1 and B keeps placement 2. The save worked; the table
   re-rendered; nothing visibly changed. The admin can't tell whether
   the save committed.

   The fix is a 5–10 line UX nudge: after a successful save, if the
   placement didn't change AND the penalty was non-zero, show a small
   inline hint explaining why ("Position unchanged — driver completed
   more laps"). The hint clears when the input value changes so it's
   never stale.

   This is explicitly NOT a semantics change. Laps-first ordering is
   correct for the way the operator runs races (timed races where the
   leader on laps wins regardless of total time) and for the future
   fixed-lap-race use case (where laps-first collapses to the right
   thing because ties on laps fall to adjusted total).

Both fit naturally under the same admin surface (global_admin only,
inline on `/racing/[raceId]`) and share the same auth gate
(`canEditRace`).

---

## Operator decisions (locked in)

| # | Question | Decision | Why |
|---|---|---|---|
| Q-H4-1 | Hard or soft delete? | **Hard delete + cascade.** | Operator wants to be rid of bad data, not archive it. `source_blob` (the raw JSON/TXT) goes with the row — irreversible. Audit log and undo are deferred (see Hand-offs). |
| Q-H4-2 | Cascade rows handled by FK or app code? | **FK cascade.** | `0003_rc_racing.sql` already has `ON DELETE CASCADE` on `rc_race_drivers.race_id` and `rc_laps.race_id`. One DELETE is enough; explicit app-level deletes would duplicate the FK contract. |
| Q-H4-3 | Confirmation UX? | **Typed-slug match.** Admin must type the race name (or race kind when name is null) into a text field; Delete button disabled until the typed text matches case-insensitively after trim. | Browser `confirm()` is a single tap and easy to fat-finger on a phone at a party. Twenty laps of data is too expensive to lose to a misclick. Typed-match enforces deliberateness. |
| Q-H4-4 | Permission helper | **Reuse `canEditRace` (global_admin only).** | No reason to split. The operator who can change a track or apply a penalty is the same operator who can delete. |
| Q-H4-5 | Redirect after delete? | **`router.push('/racing')`** from the client. NOT `router.refresh()` — the current route's race is gone, a refresh would render a 404. | The race list is the natural next surface. |
| Q-H4-6 | Penalty-unchanged hint copy | **"Position unchanged — driver completed more laps"** | Direct, names the cause (laps, not time). 50 chars; fits inline below the Save button without wrap on mobile. |
| Q-H4-7 | When does the hint appear? | **Only when `placement_before === placement_after` AND `penalty_ms > 0`.** Cleared on next input change. | Clearing a penalty (to 0) should not surface "unchanged" — the operator already knows what they did. Stale-hint clear-on-change prevents the hint sticking after the operator changes the input. |
| Q-H4-8 | How does the client know the "before" placement? | **The API route returns `placement_before` and `placement_after` in the 200 response.** Pre-existing PATCH endpoint already returns `placement` (= `placement_after`); add the pre-save placement to the same response. | One round-trip. The client could compute `before` locally from the row prop, but tracking server-truth across re-renders is brittle; the server is the source of truth. |
| Q-H4-9 | Where is the "before" placement read? | **At the API route level, BEFORE calling `setDriverPenalty`.** Simpler than threading two return values out of `setDriverPenalty`. `setDriverPenalty`'s contract stays as it is. | Avoids touching the H2 DB function's signature. The route already reads `standingsForRace` after — read it once before too. |
| Q-H4-10 | Migration needed? | **No.** | No schema delta. Cascade FKs already in place; UX hint is presentation-only. |
| Q-H4-11 | Wizard changes? | **None.** | Zero wizard edits. |

---

## Files I'll change

Under `eloup-web/`:

| File | Status | Change |
|---|---|---|
| `lib/db/rc.ts` | edit | Add `deleteRace(db, raceId): {status: 'ok'} \| {status: 'no_row'}`. Single DELETE wrapped in `db.transaction(...).immediate()` for consistency with H2's mutations. |
| `app/api/racing/races/[raceId]/route.ts` | edit | Add `DELETE` handler. Auth gate via `canEditRace`. 401 / 403 / 404 / 204. |
| `app/api/racing/races/[raceId]/drivers/[driverId]/route.ts` | edit | Extend PATCH response: read placement BEFORE calling `setDriverPenalty`, then again after. Return `{status, placement_before, placement_after, penalty_ms}`. |
| `components/RaceAdminPanel.tsx` | edit | (1) Per-driver penalty row: track the last-save response; show "Position unchanged — driver completed more laps" when `placement_before === placement_after && penalty_ms > 0`; clear on input change. (2) New Danger-zone section at the bottom: typed-slug confirmation input + red Delete button. |
| `tests/unit/rc-admin-edits.test.ts` | edit | Add `deleteRace` happy path + `no_row` case. |
| `tests/integration/rc-admin-edits.test.ts` | edit | Add DELETE 401/403/404/204 paths; cascade-delete row-count assertions for `rc_race_drivers` and `rc_laps`; deleting one race leaves another race's rows intact; PATCH penalty response includes `placement_before` + `placement_after`. |

Out of `eloup-web/`: no symbol changes, no docs changes, no wizard
changes. H4 doesn't shift the `racing` symbol's properties — it's
still display-driven, admin-uploaded, anonymous-readable. Hard-delete
is an admin-only extension consistent with `upload_role:
global_admin`. No migration.

---

## Phase A — Delete race

### `deleteRace(db, raceId): {status: 'ok'} | {status: 'no_row'}`

```ts
export function deleteRace(
  db: Database.Database,
  raceId: string,
): { status: 'ok' } | { status: 'no_row' } {
  const tx = db.transaction(() => {
    const result = db.prepare(`DELETE FROM rc_races WHERE id = ?`).run(raceId);
    if (result.changes === 0) return { status: 'no_row' as const };
    return { status: 'ok' as const };
  });
  return tx.immediate();
}
```

Single DELETE. The cascade FKs on `rc_race_drivers.race_id` and
`rc_laps.race_id` (`0003_rc_racing.sql:38,52`) clear the dependent
rows. The `.immediate()` mode mirrors `setRaceTrack` and
`setDriverPenalty` from H2 — keeps the mutation-tx pattern uniform.

### `DELETE /api/racing/races/[raceId]`

Same auth-gate envelope as the existing PATCH on this route:

```ts
export async function DELETE(_req: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canEditRace(sp)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { raceId } = await params;
  const handle = db();
  const result = deleteRace(handle, raceId);
  if (result.status === 'no_row') {
    return NextResponse.json({ error: 'race not found' }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
```

Returns 204 with no body on success. 401 / 403 / 404 mirror the PATCH
contract. No body needed for the success path — the client knows what
it sent.

### `RaceAdminPanel` — Danger zone section

A new `<DangerZone>` sub-component at the bottom of the panel,
separated from the track + penalty controls by a top border
(`border-t border-red-900/30`, per reviewer NIT #7):

- Heading: "Danger zone" (red-toned: `text-red-400`).
- Subtitle: "Delete this race permanently. Cascades to all driver
  rows and lap times."
- Confirmation input: `<input type="text" inputmode="text">` with
  placeholder `Type "<race_name_or_kind>" to confirm`.
- Delete button: `bg-red-600`, `h-tap min-w-tap`, **uses
  `useTransition` + `disabled={!matches || pending}`** per reviewer
  MAJOR #2. The pattern mirrors `TrackChangeForm` / `PenaltyRow`.
- On click: `start(async () => { const resp = await fetch(url,
  {method: 'DELETE'}); if (resp.status === 204) { router.push('/racing');
  router.refresh(); } else { setConfirm(''); setErr(...); } })`. The
  `router.refresh()` (reviewer MINOR #4) busts the App Router client
  cache so `/racing` does not briefly render the deleted race.
- **On non-204 (401/403/404/etc):** reset `confirm` state to `''`
  (per reviewer MINOR #3) — prevents the button remaining enabled
  after error without re-typing — and render inline
  `<p className="text-xs text-red-400">` with the error message.

The confirmation string is the race name when present, else the race
kind (`race` / `practice` / `qualif`) — same fallback the page header
uses (`<h1>{race.race_name ?? race.race_kind}</h1>`).

`inputmode="text"` is the iOS default but stated explicitly to pin
the choice in code (the H2 penalty input uses `inputmode="decimal"`
for the number keyboard; this one wants the standard text keyboard
since names can contain spaces and letters).

---

## Phase B — Penalty UX hint

### API route — `PATCH /api/racing/races/[raceId]/drivers/[driverId]`

Currently the route runs:

```ts
const result = setDriverPenalty(handle, raceId, driverId, parsed.data.penalty_ms);
// ...
const standings = standingsForRace(handle, raceId);
const row = standings.find((s) => s.driver_id === driverId);
return NextResponse.json({
  status: 'ok',
  placement: row?.placement ?? null,
  adjusted_total_time_ms: row?.adjusted_total_time_ms ?? null,
});
```

H4 extension: read the driver's placement BEFORE `setDriverPenalty`
runs, then again after. Return both. The H2 `setDriverPenalty`
signature stays unchanged — the API route fetches its own context.

```ts
const handle = db();

// Capture placement before the recompute so the UI can detect a
// no-op-on-placement save (penalty applied but laps_completed kept
// the driver in the same row). The hint is a UX nudge, not a
// semantics signal — the placement-recompute logic is unchanged.
const beforeRow = standingsForRace(handle, raceId).find((s) => s.driver_id === driverId);
const placement_before = beforeRow?.placement ?? null;

const result = setDriverPenalty(handle, raceId, driverId, parsed.data.penalty_ms);
switch (result.status) {
  case 'invalid':
    return NextResponse.json({ error: 'invalid penalty' }, { status: 400 });
  case 'no_row':
    return NextResponse.json({ error: 'race driver not found' }, { status: 404 });
  case 'ok': {
    const afterRow = standingsForRace(handle, raceId).find((s) => s.driver_id === driverId);
    return NextResponse.json({
      status: 'ok',
      placement_before,
      placement_after: afterRow?.placement ?? null,
      adjusted_total_time_ms: afterRow?.adjusted_total_time_ms ?? null,
      penalty_ms: parsed.data.penalty_ms,
    });
  }
}
```

Notes:

- `placement_before` is captured with the **pre-recompute** state.
  The recompute fires inside `setDriverPenalty`. After the call, the
  driver's `placement` is the new one.
- `placement_after` is the post-recompute placement.
- `placement` (the H2 single-field response) is dropped in favour of
  the more descriptive pair. **No existing HTTP caller reads
  `placement` from the PATCH response body** — `RaceAdminPanel.tsx`'s
  `PenaltyRow` calls `router.refresh()` only and never inspects the
  response body beyond `error`; existing tests call `setDriverPenalty`
  / `standingsForRace` at the lib boundary, not via HTTP. Dropping
  `placement` is therefore non-breaking (verified by the reviewer,
  MAJOR #1).
- `placement_before === null` and `placement_after === null` can
  happen if `standingsForRace` returns no row for the driver — a
  test edge case, not a production path. The client's `typeof === 'number'`
  guards suppress the hint in that case (reviewer MINOR #5).
- `penalty_ms` is echoed back so the client doesn't have to remember
  what it sent (mostly a convenience; also a sanity check).
- The two `standingsForRace` calls bracket the mutation. They're
  cheap (one SELECT each, < 8 rows per fixture race). The route is
  not on a hot path.

### `RaceAdminPanel.tsx` — penalty row hint

In `PenaltyRow`:

```ts
const [hint, setHint] = useState<string | null>(null);

// ...
onClick: async () => {
  setErr(null);
  setHint(null);
  // ...
  const data = await resp.json().catch(() => null);
  if (
    data &&
    typeof data.placement_before === 'number' &&
    typeof data.placement_after === 'number' &&
    typeof data.penalty_ms === 'number' &&
    data.placement_before === data.placement_after &&
    data.penalty_ms > 0
  ) {
    setHint('Position unchanged — driver completed more laps');
  }
  router.refresh();
}
```

And on input change:

```ts
onChange: (e) => {
  setValue(e.target.value);
  setHint(null);  // clear stale hint when the input changes
}
```

Render below the Save button:

```tsx
{hint && <p className="mt-1 text-xs text-amber-400">{hint}</p>}
```

Visual: amber (matches the H2 penalty-column accent — same colour
palette across the page so the operator's eye knows "this is about a
penalty"). `text-xs` (12px) matches the existing error-row styling
(`text-xs text-red-400`) per reviewer NIT #8 — actionable feedback
should be as legible as error text.

The hint never appears when:

- The penalty was set to 0 (clearing a prior penalty — the operator
  doesn't need to be told why placement didn't change).
- The save failed (the error message takes precedence).
- The placement DID change (the visual reorder of the standings
  table above is signal enough).

---

## Three must-work flows

### Flow 1 — Hard delete a race

A `global_admin` opens `/racing/<raceId>`, scrolls past the
standings, past the existing track + penalty controls, into the new
**Danger zone** section at the bottom of the Admin panel. The race is
named "R2" (or has `race_name = null`, in which case the kind `race`
is the confirmation string). They type `R2` (or `race`) into the
"Type to confirm" input. The Delete button enables. They tap it. The
client sends `DELETE /api/racing/races/<raceId>`; the server checks
the session, runs `deleteRace`, returns 204. The client runs
`router.push('/racing')`. The race list re-renders without the
deleted race. Visiting `/racing/<that-id>` directly returns 404
(`getRace` returns `null`). `SELECT COUNT(*) FROM rc_race_drivers
WHERE race_id = '<that-id>'` returns 0; same for `rc_laps`. The
race's drivers (the `rc_drivers` rows themselves) are unaffected —
they may still appear in other races' standings.

### Flow 2 — Penalty applied; placement DOESN'T change (hint appears)

Same admin, different race. Driver A has 21 laps, total 330s. Driver
B has 20 laps, total 290s. Placement: A=1, B=2 (laps DESC). The
admin applies a 5s penalty to A. Client POSTs `{penalty_ms: 5000}`.
Server captures `placement_before = 1`, runs `setDriverPenalty` (A's
adjusted total becomes 335s; recompute still places A at 1 because
A's laps_completed = 21 > B's 20), captures `placement_after = 1`,
returns `{status: 'ok', placement_before: 1, placement_after: 1,
penalty_ms: 5000, adjusted_total_time_ms: 335000}`. The PenaltyRow
sees `before === after && penalty_ms > 0` and renders "Position
unchanged — driver completed more laps" in amber under the Save
button. The standings table above re-renders with A's Penalty column
showing `+5.0s` and A's Total reading 335.00s, but A is still in row
1. The hint clears the next time the operator types a new value into
A's input.

### Flow 3 — Penalty applied; placement DOES change (no hint)

Same admin, third race. Two drivers, both completed 20 laps. A's
total 290.0s, B's total 290.5s. Placement: A=1, B=2 (laps tied, time
breaks). The admin applies a 1s penalty to A (A's adjusted total
becomes 291.0s). Server captures `placement_before = 1`, runs
recompute (now A's adjusted-total 291.0s > B's 290.5s; recompute
flips placements), captures `placement_after = 2`, returns
`{placement_before: 1, placement_after: 2, ...}`. The PenaltyRow
sees `before !== after`, does NOT render the hint. The standings
table reorders: B in row 1, A in row 2. The visual reorder is the
signal the save took effect.

---

## Test plan

~8–10 new tests. Vitest, same harness as H2/H3. Ephemeral SQLite per
file (`mkdtempSync` + `applyMigrations`), no DB mocks.

### Unit (`tests/unit/rc-admin-edits.test.ts` — edits)

1. `deleteRace` happy path: import the fixture, call
   `deleteRace(db, raceId)`, assert returns `{status: 'ok'}`, assert
   `getRace(db, raceId) === null`, assert
   `SELECT COUNT(*) FROM rc_race_drivers WHERE race_id = ?` is 0,
   same for `rc_laps`.
2. `deleteRace` for missing race id: assert returns
   `{status: 'no_row'}`; no other rows touched.

### Integration (`tests/integration/rc-admin-edits.test.ts` — edits)

3. DELETE 401: no session → `{error: 'unauthenticated'}`, status 401.
4. DELETE 403: a non-`global_admin` session (e.g. `'user'`) →
   `{error: 'forbidden'}`, status 403.
5. DELETE 404: valid admin session but a `raceId` that doesn't exist
   → `{error: 'race not found'}`, status 404.
6. DELETE 204: valid admin session + real `raceId`. Assert response
   is empty body with status 204; assert
   `SELECT COUNT(*) FROM rc_race_drivers WHERE race_id = ?` is 0
   AND `SELECT COUNT(*) FROM rc_laps WHERE race_id = ?` is 0.
7. Cross-race isolation: import the fixture (which yields multiple
   races); capture a BEFORE row count for race B
   (`SELECT COUNT(*) FROM rc_race_drivers WHERE race_id = ?`);
   DELETE race A; assert race B's row counts in `rc_race_drivers`
   and `rc_laps` equal the captured BEFORE count (per reviewer
   MINOR #6 — without the BEFORE capture the assertion would pass
   vacuously on an empty fixture).
8. PATCH penalty response shape: apply a non-zero penalty;
   assert the response body has both `placement_before` and
   `placement_after` as numbers (alongside the existing
   `adjusted_total_time_ms` field).
9. PATCH penalty: laps-locked case. Construct a 2-driver scenario
   (or pick one out of the fixture) where applying a 5s penalty to
   the leader does NOT change placement (because the leader has
   more laps than the follower). Assert the response has
   `placement_before === placement_after` and `penalty_ms === 5000`.
10. PATCH penalty: tiebreak-flips case. Construct a 2-driver scenario
    with equal `laps_completed` where applying a penalty flips the
    order. Assert `placement_before !== placement_after`.

### Optional (skip if vitest+React Testing Library is not already wired)

11. Component-level render check: shallow-render `PenaltyRow` with a
    mocked `fetch` returning `placement_before === placement_after
    && penalty_ms > 0`, assert the "Position unchanged" string
    appears in the DOM. **Skipped if the repo has no existing
    component-level test harness.** Tests 1–10 already cover the
    server-side contract; the React assertion is a nice-to-have.

### Test-count expectation

~9 new + 1 optional = 9–10 net new tests. No existing tests should
break (the PATCH response now carries additional fields beyond
`placement` — but the H2 tests, if they assert on response shape,
need to update their assertions from `placement` to
`placement_after`). I'll grep `placement` in the existing test files
during commit 4 and update any direct assertions then.

---

## Quality bar (same as M1–R1, H1, H2, H3)

- No comments unless WHY is non-obvious. The `placement_before`
  capture's "before/after bracket" rationale is worth one comment
  in the API route.
- No mocks at the DB boundary. Ephemeral SQLite per test file.
- TypeScript strict; no `any` without a `// reason:` line.
- ESLint + Prettier + typecheck + build clean.
- Mobile-first: 44px tap targets on Delete button + confirmation
  input. `inputmode="text"` on the confirmation input. The amber
  hint's `text-[10px]` matches existing tiny-text patterns.

---

## Verification

After implementation (commit 4):

1. `python3 scripts/align.py check` exits 0. No symbol change — H4
   doesn't add new symbols or change `racing` properties.
2. `cd wizard && python3 -m pytest -q` — still 104 passing. H4
   makes zero wizard edits.
3. `cd eloup-web && pnpm test && pnpm lint && pnpm typecheck && pnpm build` clean.
4. `docker build -f Dockerfile.eloup-web .` succeeds.
5. **Do NOT run the wizard. Do NOT push to remote. Do NOT call any
   prod API.** The operator handles deploy after implementation is
   reviewed and merged.

---

## Out of scope for H4 (do NOT build)

- **Soft delete / restoration.** Hard delete only per Q-H4-1. An
  `archived_at` column + a `/racing/admin/archived` view is the
  natural follow-up — see Hand-offs.
- **Audit log of deletions.** Recording who deleted what and when
  is useful in a multi-admin world but the operator is a single
  admin today. Deferred.
- **Bulk delete.** Per-race only. The operator deletes individual
  bad uploads; bulk deletion is a separate workflow.
- **Editing race fields other than what H2 covers (track) and H4
  adds (delete).** Editing `race_name`, `race_kind`, `race_started_at`,
  `duration_seconds`, etc. is a separate small task.
- **`penalty_laps` knob.** Not needed — the operator is moving to
  fixed-lap races where penalty-as-time-only is correct (laps tie →
  time decides → penalty matters).
- **Changing the placement-recompute ordering.** The current
  `laps DESC, adjusted_total ASC, transponder ASC` is correct for
  the operator's use case and matches the importer. H4 is a UX
  nudge ONLY.
- **Wizard changes.** H4 should require zero wizard edits.
- **Per-driver removal from a race.** Removing a driver from one
  race (vs deleting the whole race) is a different workflow.

---

## Commit shape

Five commits expected (mirroring H2 + H3 discipline):

1. `docs: H4 — race deletion + penalty UX task doc` — this file
   only. **STOP after this commit and request review.**
2. `docs: H4 — reviewer report` — landed by a different agent in
   `Agents/Review-reports/h4-race-deletion-and-penalty-ux-review.md`
   referencing this filename.
3. `docs: H4 — fold reviewer findings, flip task to In Progress` —
   ONLY if review flags MAJOR-grade changes that require a doc
   update before implementation. Otherwise skip and absorb the
   reviewer's notes inline in commit 4.
4. `feat: eloup-web — race deletion + penalty UX hint` — Phase A
   + Phase B + Phase C tests. One commit because the two halves
   share `RaceAdminPanel.tsx` (the panel grows a Danger zone AND
   the penalty row grows a hint slot) and the test file edits
   touch both halves.
5. `docs: H4 — mark task Complete` — flip Status, verification
   results in the commit body.

Each commit ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Hand-offs

After H4 ships, the following follow-ups are natural but deferred:

- **Soft delete / undo.** If the operator hits a hard-delete they
  regret, the current path is "re-upload the original
  JSON/TXT" (assuming they kept the source file). An `archived_at`
  column on `rc_races` plus a `/racing/admin/archived` view with a
  "Restore" button would let an operator un-delete without
  re-uploading. The migration is one column + one nullable index;
  the UI is half a page. Out of scope here.
- **Deletion audit log.** A small `rc_admin_edits` table (race_id,
  edit_kind ∈ {delete, track_change, penalty}, actor_id, edited_at,
  old_value, new_value) would record who did what. Useful when
  multiple admins exist. Companion to the H2 hand-off note on the
  same table.
- **Fixed-lap races.** The operator mentioned switching to a
  fixed-lap format. The placement-recompute ordering already does
  the right thing for fixed-lap (laps will tie for everyone who
  finishes, then adjusted total decides). No code changes needed
  for the switch; the H4 penalty hint will naturally not fire in
  that mode because `placement_before !== placement_after` becomes
  the common case.
- **Per-driver delete (remove a driver from a race).** Different
  workflow from "delete the whole race." Operator might want to
  excise a driver who DNS'd but registered. Out of scope here; the
  natural shape is `DELETE /api/racing/races/<raceId>/drivers/<driverId>`
  with the same recompute fold pattern as `setDriverPenalty`.
- **Cross-format dedup hooks for delete.** When a TXT-imported race
  was deduped against a later JSON (per H3), the row's
  `lap_monitor_uuid` is the TXT's synthetic SHA-1. Deleting that
  row removes both the TXT and any implicit JSON pairing. No code
  changes needed — the cascade FKs handle it — but worth flagging
  to the operator so they understand "delete removes the union of
  sources."

---

## Clarifying questions surfaced while writing this doc

Flagging for the reviewer:

1. **Race-name fallback for confirmation: case sensitivity.** I
   picked case-insensitive trim match (so the operator can type
   `r2` and match `R2`). Stricter case-sensitive matching would
   prevent the operator from typing the wrong case and submitting,
   but on a phone keyboard auto-capitalization is unpredictable.
   I lean case-insensitive; happy to switch.

2. **Confirmation string for races with very long names.** The
   operator's actual race names are short ("R2", "Final", etc.) but
   the schema allows `race_name TEXT` (no length cap). A 200-char
   race name would make the confirmation prompt awkward. I think
   this is fine in practice (long names are an operator-caused
   problem) but flagging in case the reviewer wants a length cap on
   the confirmation prompt (e.g. truncate to 40 chars in the
   placeholder).

3. **DELETE response: 204 with no body vs 200 with `{status: 'ok'}`.**
   I picked 204 (REST-conventional for a successful DELETE with
   nothing to return). The existing PATCH uses 200 with a body. If
   the reviewer prefers uniformity (always 200 with a body), I'll
   switch.

4. **Penalty hint persistence.** I clear the hint on input change.
   What about on a re-save with the same value? The hint will
   re-appear (because the second save sees the same
   before/after = same placement). Reasonable behaviour — each
   save communicates its own result — but flagging in case the
   reviewer prefers debounce-style "don't re-show the same hint
   twice in a row."

5. **DELETE + active session of another admin.** If two admins are
   on `/racing/<raceId>` simultaneously and one deletes, the other
   sees a stale page until they navigate away or refresh. There's
   no real-time invalidation in eloup; the next page load returns
   404. I think this is acceptable for a party app with one admin
   at a time. Flagging in case the reviewer wants a brief note in
   the UI ("This race may have been deleted by another admin —
   refresh to confirm") — I left it out because it adds complexity
   for a near-zero-frequency case.
