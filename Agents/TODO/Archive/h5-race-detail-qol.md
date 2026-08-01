# H5 — Race-detail QoL: desktop layout, chart toggle, Discord linking, 3-up compare

## Author: claude-opus-4.7-h5-implementer
## Status: Complete

## Reviewer findings folded (2026-05-17)

`Agents/Review-reports/h5-race-detail-qol-review.md` (verdict
APPROVE-WITH-CHANGES, 2 MAJOR / 5 MINOR / 2 NIT) — load-bearing
changes absorbed below before Phase B/C/D implementation:

- **MAJOR #1 — iOS Safari context-menu suppression.** Every chip
  `<button>` in `LapChart` AND `CompareDriversSection` adds
  `onContextMenu={(e) => e.preventDefault()}` plus
  `className="… touch-none"` so the 500ms long-press isolate gesture
  does not collide with Safari's system context menu / text-selection
  popover at exactly the same threshold. Documented with a
  load-bearing code comment so a future maintainer does not strip the
  preventDefault as dead code.

- **MAJOR #2 — Drop the URL-sync `useEffect`.** `CompareDriversSection`
  no longer mirrors `selected → URL` via effect (the effect fires on
  mount with empty selection and clobbers any unrelated query param).
  Instead, the toggle callback calls
  `router.replace(buildUrl(next), { scroll: false })` synchronously in
  the same tick as the `setSelected` update. Initial state is still
  read from `useSearchParams` on first render; no effect needed to
  mirror it back.

- **MINOR #3 — Y-axis rescale-on-toggle-back acknowledged.** The
  `lapChartClipMaxY` call site filters the input array by the visible
  driver set, so the Y axis recomputes whenever the visible set
  changes (including on toggle-back). Documented inline. Signature of
  `lapChartClipMaxY` itself is preserved — the filtering happens at
  the call site so `tests/unit/lap-chart-clip.test.ts` continues to
  pin the function's contract unchanged.

- **MINOR #5 — LIKE metacharacter escaping in `searchPlayers`.**
  Discord handles can legitimately contain `_`; `%` and `_` are
  escaped before constructing the LIKE pattern, and the SQL uses
  `ESCAPE '\'`. Test case added: `searchPlayers(db, 'user_name')`
  matches only literal `user_name`, not `userXname`.

- **MINOR #6 — `CompareDriversSection` test seam.** Definitive seam
  is the `initialSelected?: string[]` prop (marked `@internal`) for
  vitest-only state injection. `useRouter` + `useSearchParams` are
  also mocked at the test boundary so the URL-write assertion can
  observe `router.replace` calls deterministically. No
  `data-testid` hacks.

- **CQ4 — Sync URL replace in toggle callback.** Folded into MAJOR #2.

- **CQ5 — Hide compare section when `< 2` drivers.**
  `CompareDriversSection` returns `null` immediately when
  `drivers.length < 2`. No "Pick 2-3 drivers" hint for 1-driver races
  (DNS / no-show edge cases).

- **MINOR #4 / NIT #8 / NIT #9** — documentation gap (file table
  already covers `/api/players/search/route.ts` in the second
  mini-table) / confirming patterns; no code change beyond the inline
  comments above.

Symbol update: still no (CQ1). Wizard: still no (Q-H5-13). Migration:
still no (Q-H5-12).

> Four small quality-of-life improvements to the RC racing surface
> that R1 shipped and H2/H3/H4 hardened. None of them touch the schema
> (`rc_drivers.player_id` is already nullable FK to `players.id`), the
> wizard, the importer, or any ELO surface (RC ELO is still R2 work).
> All four phases share the same auth gate (`canEditRace` →
> `global_admin`) and the same review/implement cadence as H4.
>
> **Author/Reviewer separation note.** Prior implementers are
> `claude-opus-4.7-{planner,m2,m3,m4,m5,h1,r1,h2,h3,h4}-implementer`;
> prior reviewers
> `claude-sonnet-4-6-{m2,m3,m4,m5,h1,r1,h2,h3,h4}-reviewer` (plus the
> early `claude-sonnet-4-6-reviewer`). The reviewer for this doc must
> pick a `## Reviewer:` field distinct from
> `## Author: claude-opus-4.7-h5-implementer`. Suggested:
> `claude-sonnet-4-6-h5-reviewer`.
>
> The reviewer should land their report at
> `Agents/Review-reports/h5-race-detail-qol-review.md` referencing
> `h5-race-detail-qol.md` in the body. Until then, the review gate
> blocks edits to `eloup-web/`.

---

## Why this task exists

R1 shipped a mobile-first racing surface; H2/H3/H4 added admin edits
(track reassign, penalty, hard delete, TXT import). Four loose ends
surfaced from real use at parties and one upstream prerequisite for R2:

1. **Desktop looks sparse.** The racing pages were intentionally
   designed for a 414px phone (primary device — see
   `cluster_conventions.md`, mobile-first PWA constraint). On a 1440px
   laptop the standings table stretches edge-to-edge with 20+ char of
   horizontal whitespace per row, and the lap chart is a thin
   horizontal stripe. No mobile regression is acceptable — the fix is
   a single `max-w-4xl mx-auto` container at the page root that caps
   reading width while leaving every responsive class untouched.

2. **The lap chart is a mess with >2 drivers.** The R1 fixture had
   exactly 2 drivers per race; the operator's recent uploads have 6–10.
   Distinct HSL hues per driver hold up colour-wise, but ten polylines
   overlap into a tangle. The operator wants to compare two specific
   drivers in a 10-driver race without exporting to a spreadsheet.
   Solution: tap a driver chip to toggle that driver's visibility,
   long-press to isolate (hide everyone else). Pure client state, no
   schema/API change.

3. **Discord linkage is set in SQL today.** `rc_drivers.player_id`
   exists, is nullable, and is read by the driver profile page already
   — but the only way to populate it is a manual `UPDATE rc_drivers
   SET player_id = ?`. This is the prerequisite for R2 (RC ELO can't
   credit a Discord-authenticated player without a populated
   `player_id`). H5 adds the admin UI: a small linker on the driver
   profile page with player search + Link/Unlink.

4. **Comparing drivers means scrolling.** The per-driver
   `<details>` collapsibles on `/racing/[raceId]` show
   `computeDriverStats` output for one driver at a time. Comparing
   two means opening two details panels and scrolling. The operator
   wants a 2–3-driver side-by-side compare table. The stats are
   exactly what `computeDriverStats` already returns — no new math.

Bundling all four into one task because:

- A + B + D all live on `/racing/[raceId]/page.tsx` — same file
  surface, same review focus.
- C lives on `/racing/drivers/[driverId]/page.tsx` and uses the same
  `canEditRace` gate as A/B/D (global_admin only).
- All four are < 100 LOC of net new code each; splitting into four
  tasks adds review overhead without adding signal. H4 set the
  precedent of bundling related admin UX in one feature commit.

---

## Operator decisions (locked in)

| # | Question | Decision | Why |
|---|---|---|---|
| Q-H5-1 | Desktop max width | **`max-w-4xl mx-auto` (896px)**. Applied to `<main>` on all `/racing/*` pages. | Smaller than the default Tailwind `max-w-5xl` (1024px) so reading width stays comfortable. 80-char monospace tables sit naturally at ~720px; 896px leaves slack for the lap chart legend without over-stretching. |
| Q-H5-2 | Optional `lg:` grid on race detail | **Yes — chart + standings side-by-side at `lg:` (1024px+) only.** Chart takes 2/3 of the row width, standings 1/3. Mobile + tablet keep the current stacked layout. | The race detail page is the highest-information surface; on a laptop the chart and the standings should fit on one screen without scrolling. Below `lg:` the stack is correct (chart is wider than 1/3 of 768px would allow). |
| Q-H5-3 | Chart visibility default | **All drivers visible by default.** Toggling a chip removes one driver from the visible set; long-press isolates that one driver. | Matches today's behaviour for first paint. The toggle is an *additional* affordance, not a default-off opt-in — operators expect to see everything when the page loads. |
| Q-H5-4 | How are hidden drivers rendered? | **Hidden entirely — no polyline, no dots.** Chip itself is rendered with reduced opacity (`opacity-40`) + a strikethrough-style border (`border-dashed`) to signal "hidden". | 10% opacity polylines tested in the fixture stay visually noisy; hiding outright is cleaner. The chip styling is enough indicator that "this driver exists but is currently hidden". |
| Q-H5-5 | Long-press duration | **500ms.** `onPointerDown` starts a `setTimeout(500)`; `onPointerUp`, `onPointerCancel`, `onPointerMove` (with movement > 5px) cancel it. If the timer fires, set visibility = {this driver only}. | 300ms is too easy to trigger accidentally on a phone; 700ms+ feels sluggish. iOS Safari's own long-press threshold is ~500ms, so the timing is muscle-memory-compatible. |
| Q-H5-6 | Movement tolerance for long-press cancel | **5px in any direction.** Track pointer position on `onPointerDown`, cancel if subsequent `onPointerMove` exceeds 5px from origin. | Prevents accidental cancellation from a thumb resting on a chip. Matches the touch-slop default in iOS/Android UIs. |
| Q-H5-7 | Discord-linking UI placement | **On `/racing/drivers/[driverId]/page.tsx`**, as a small admin-only section below the "Linked to" line. | The driver profile is the natural surface — it's where the operator looks at "who is this driver?" Adding a per-race linker would force per-race repetition. |
| Q-H5-8 | Player search criterion | **Case-insensitive substring match on `display_name` OR `discord_handle`.** Top 5 results. Empty query returns empty (no "show all 50 players" dump). | Discord handles are unique and memorable ("brandonw"); display names are what the operator typically remembers ("Brandon"). Substring lets both work. |
| Q-H5-9 | Compare picker capacity | **Up to 3 drivers selectable.** Selecting a 4th replaces the oldest (queue behaviour). | 2-driver compare is the common case; 3 covers podium scenarios. 4+ columns get cramped on a 414px phone (compare table is below the chart, has the same width constraint). FIFO replacement matches Discord's `@everyone` mention auto-truncate pattern — predictable. |
| Q-H5-10 | Compare selection persistence | **URL query param `?compare=id1,id2,id3`.** Toggling a chip calls `router.replace('?compare=...', {scroll: false})`. | Sharing a comparison view is operator-actionable (bookmark, paste into Discord). `useSearchParams` + `useRouter` is the standard Next.js App Router pattern; `scroll: false` keeps the page from jumping when the URL updates. |
| Q-H5-11 | Permission helper for Phase C | **Reuse `canEditRace` (already `global_admin` only).** No new helper. | Same operator who can change a track / apply a penalty / delete a race / link a driver. Adding `canLinkDriver` would duplicate the contract without changing behaviour. |
| Q-H5-12 | Migration needed? | **No.** `rc_drivers.player_id` is already a nullable FK to `players(id)` per `0003_rc_racing.sql:181`. | Phase C only writes the existing column. |
| Q-H5-13 | Wizard changes? | **None.** | Zero wizard edits. The wizard test suite (104 passing) is not exercised by H5. |
| Q-H5-14 | Symbol updates? | **Optional.** May add `app.compare_max: 3` and `app.driver_player_link: admin_ui` to the `racing` symbol's `properties`. Decision: **no symbol change.** The current `racing` symbol describes the domain at a coarse grain (display-only, anonymous-readable, admin-uploaded) — neither the compare cap nor the existence of a UI for an already-typed column is at that grain. Revisit when R2 adds `elo_integrated: true`. | Keeps the symbol stable; H5 is purely UX. |

---

## Files I'll change

Under `eloup-web/`:

| File | Status | Change |
|---|---|---|
| `app/racing/page.tsx` | edit | Wrap `<main>` content with `max-w-4xl mx-auto`. Mobile layout unchanged. |
| `app/racing/[raceId]/page.tsx` | edit | (A) Wrap with `max-w-4xl mx-auto`. Add `lg:` grid layout that places chart (2/3 col-span) next to standings (1/3 col-span). (B) Extract chart section into `<RaceChartSection>` client component to hold `visibleDriverIds` state. (D) Render `<CompareDriversSection>` between admin panel and lap-by-lap details. |
| `app/racing/drivers/[driverId]/page.tsx` | edit | (A) Wrap with `max-w-4xl mx-auto`. (C) Extend the "Linked to" section: when admin, render `<DriverPlayerLink>` client component with player search + Link/Unlink button. Show linked player's `display_name` + `@discord_handle` when set, "Not linked" otherwise. |
| `app/racing/tracks/[slug]/page.tsx` | edit | (A) Wrap with `max-w-4xl mx-auto`. |
| `app/racing/upload/page.tsx` | edit | (A) Wrap with `max-w-4xl mx-auto`. |
| `components/LapChart.tsx` | edit | (B) Add `visibleDriverIds: Set<string>` prop; filter polylines + dots by membership. Chips become buttons with `onPointerDown` / `onPointerUp` / `onPointerCancel` / `onPointerMove` for tap-toggle + long-press-isolate; calls back via two props (`onToggle(id)` + `onIsolate(id)`). Hidden chips render with `opacity-40 border-dashed`. |
| `components/RaceChartSection.tsx` | new | (B) Client wrapper holding `visibleDriverIds` state (initialised to all driver ids), passing toggle + isolate callbacks down to `LapChart`. Pure client; no fetch. |
| `components/CompareDriversSection.tsx` | new | (D) Client component. Takes the standings array + a per-driver lap list (passed in pre-computed by the server page). Renders chip row + URL-synced selection + side-by-side table. |
| `components/DriverPlayerLink.tsx` | new | (C) Client component. Takes `driverId`, `currentLink: {id, display_name, discord_handle} \| null`. Renders player search input (debounced 200ms), top-5 results list, Link / Unlink button. PATCHes `/api/racing/drivers/<driverId>`. |
| `lib/db/rc.ts` | edit | (C) Add `setDriverPlayer(db, driverId, playerId \| null): {status: 'ok'} \| {status: 'no_driver'} \| {status: 'no_player'}`. Add `getDriverWithLinkedPlayer(db, driverId)` returning the driver row plus the linked player's `display_name` + `discord_handle` (LEFT JOIN), so the page doesn't make a second query. |
| `lib/db/queries.ts` | edit | (C) Add `searchPlayers(db, query: string, limit = 5): Array<{id, display_name, discord_handle}>`. **NOT** a new module — extends the existing player-query surface. Case-insensitive substring match on `display_name` OR `discord_handle`; empty query returns empty array. |
| `app/api/racing/drivers/[driverId]/route.ts` | new | (C) `PATCH` handler. Body `{ player_id: string \| null }`. Auth: 401/403/404 (driver)/400 (zod)/200 (`{status: 'ok', player_id}`). Calls `setDriverPlayer`. |
| `tests/unit/rc-admin-edits.test.ts` | edit | (C) `setDriverPlayer` happy path / no_driver / no_player / null-clears. |
| `tests/unit/queries.test.ts` (new file) | new | (C) `searchPlayers` — by handle, by display_name, case-insensitive, limit cap, empty query, no matches. |
| `tests/integration/rc-admin-edits.test.ts` | edit | (C) `PATCH /api/racing/drivers/<id>` 401/403/404/200/null-clears. |
| `tests/unit/compare-drivers-section.test.ts` (new file) | new | (D) Component-level: 0 selected = empty state; 1 selected = "select at least 2"; 2 selected = 2-column table; 3 selected = 3-column; 4th selection replaces oldest. URL persistence — initial state from `?compare=a,b,c`. |
| `tests/unit/lap-chart-visibility.test.ts` (new file) | new | (B) `LapChart` with `visibleDriverIds` filters rendered polylines; hidden chips have `opacity-40` class. |

Out of `eloup-web/`: no symbol changes (per Q-H5-14), no docs changes,
no wizard changes, no migrations.

---

## Phase A — Desktop max-width container

Each of the five page files gets a single class change on the root
`<main>`:

```tsx
// Before:
<main className="p-4">
// After:
<main className="mx-auto max-w-4xl p-4">
```

`mx-auto` centers the container; `max-w-4xl` caps it at 896px. The
existing `p-4` (16px padding) is preserved so the mobile layout is
visually identical. Below 896px viewport the container expands to
fill, so phones see exactly today's layout.

**Race detail (`[raceId]/page.tsx`) additional `lg:` grid.** Above
the standings section, wrap the chart + standings sections in a
`grid` that activates at `lg:`:

```tsx
<div className="lg:grid lg:grid-cols-3 lg:gap-6">
  <section className="lg:col-span-2">
    <RaceChartSection ... />
  </section>
  <section className="lg:col-span-1">
    {/* standings table */}
  </section>
</div>
```

Mobile (`< 1024px`) collapses to `block` → today's stacked layout.
Tablets up to 1023px stay stacked. At `lg:` (1024px+) chart takes 2/3
width, standings takes 1/3. The standings table's existing
`w-full` lets it fill its column.

The admin panel + lap-by-lap details + compare section sit *below*
the grid in a full-width block (the compare table needs the full
container width when 3 drivers are picked).

---

## Phase B — Chart toggle + isolate

### `LapChart` prop surface

Add two props:

```ts
type LapChartProps = {
  drivers: LapChartDriver[];
  visibleDriverIds?: Set<string>;            // default = all driver ids visible
  onToggle?: (driverId: string) => void;
  onIsolate?: (driverId: string) => void;    // long-press
};
```

Inside `LapChart`:

- `const visible = visibleDriverIds ?? new Set(drivers.map(d => d.driverId));`
- Polyline + dot rendering: skip drivers whose id is not in `visible`.
- Y-axis tick computation: include only laps from visible drivers
  (so isolating one driver re-scales the Y-axis to that driver's
  range — see Q-H5-3 rationale; first paint is "all visible" so
  initial scale is unchanged).
- Chip rendering: each chip becomes a `<button type="button">` with
  the long-press handlers below. Hidden chips render with
  `opacity-40 border-dashed` instead of the default solid border.

### Long-press handler

A small ref-based timer per chip (one `useRef<{ timer: NodeJS.Timeout
| null; origin: {x: number, y: number} | null }>()` per chip — easier
to manage as a per-chip `useState` or as a closure inside the chip
component):

```tsx
function DriverChip({ driver, isVisible, onToggle, onIsolate }: ...) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };

  return (
    <button
      type="button"
      className={chipClasses(isVisible)}
      onPointerDown={(e) => {
        longPressFired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          longPressFired.current = true;
          onIsolate(driver.driverId);
          cancel();
        }, 500);
      }}
      onPointerMove={(e) => {
        if (!origin.current) return;
        const dx = e.clientX - origin.current.x;
        const dy = e.clientY - origin.current.y;
        if (dx * dx + dy * dy > 25) cancel();   // > 5px movement
      }}
      onPointerUp={() => {
        if (timer.current) {
          // short tap — fire toggle
          cancel();
          if (!longPressFired.current) onToggle(driver.driverId);
        }
      }}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
    >
      ...
    </button>
  );
}
```

Notes:

- `longPressFired` ref prevents the `onPointerUp` from firing a
  toggle immediately after a long-press isolate.
- Movement tolerance is 5px (Q-H5-6); 25 = 5² avoids the sqrt.
- `onPointerLeave` cancels too — if the operator drags off the chip
  mid-press, no isolate fires.
- All four pointer events are needed to handle iOS Safari (which
  sometimes fires `onPointerCancel` instead of `onPointerUp` on scroll).

### `RaceChartSection` wrapper

```tsx
'use client';

export function RaceChartSection({ drivers }: { drivers: LapChartDriver[] }) {
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(drivers.map((d) => d.driverId)),
  );

  return (
    <LapChart
      drivers={drivers}
      visibleDriverIds={visible}
      onToggle={(id) =>
        setVisible((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          // Never let the user hide everyone — keep at least one visible.
          if (next.size === 0) return prev;
          return next;
        })
      }
      onIsolate={(id) => setVisible(new Set([id]))}
    />
  );
}
```

Edge case pinned: if the operator toggles every driver off, the last
toggle is a no-op (we keep `prev`). The chart should never render
empty when drivers exist; if the operator wants to "reset" they can
long-press any chip + toggle from there, or refresh.

The race detail page passes the pre-built `chartData` array down
unchanged.

---

## Phase C — Discord linking on driver profile

### `setDriverPlayer(db, driverId, playerId | null)`

```ts
export function setDriverPlayer(
  db: Database.Database,
  driverId: string,
  playerId: string | null,
): { status: 'ok' } | { status: 'no_driver' } | { status: 'no_player' } {
  const tx = db.transaction(() => {
    const driver = db.prepare(`SELECT id FROM rc_drivers WHERE id = ?`).get(driverId) as
      | { id: string }
      | undefined;
    if (!driver) return { status: 'no_driver' as const };

    if (playerId !== null) {
      const player = db.prepare(`SELECT id FROM players WHERE id = ?`).get(playerId) as
        | { id: string }
        | undefined;
      if (!player) return { status: 'no_player' as const };
    }

    db.prepare(`UPDATE rc_drivers SET player_id = ? WHERE id = ?`).run(playerId, driverId);
    return { status: 'ok' as const };
  });
  return tx.immediate();
}
```

Same `.immediate()` tx pattern as `setRaceTrack` / `setDriverPenalty`
/ `deleteRace`. Validates the FK in app code (SQLite enforces it too,
but a typed status is friendlier than an `FOREIGN KEY` exception).

### `getDriverWithLinkedPlayer(db, driverId)`

```ts
export type RcDriverWithPlayerRow = RcDriverRow & {
  linked_display_name: string | null;
  linked_discord_handle: string | null;
};

export function getDriverWithLinkedPlayer(
  db: Database.Database,
  driverId: string,
): RcDriverWithPlayerRow | null {
  return (
    (db
      .prepare(
        `SELECT d.id, d.lap_monitor_driver_uuid, d.display_name, d.player_id, d.created_at,
                p.display_name   AS linked_display_name,
                p.discord_handle AS linked_discord_handle
           FROM rc_drivers d
           LEFT JOIN players p ON p.id = d.player_id
          WHERE d.id = ?`,
      )
      .get(driverId) as RcDriverWithPlayerRow | undefined) ?? null
  );
}
```

Replaces the inline ad-hoc query the driver-profile page does today
(`page.tsx:24-30`) — one SQL round-trip instead of two, and the
shape is typed.

### `searchPlayers(db, query, limit = 5)` in `lib/db/queries.ts`

```ts
export type PlayerSearchHit = {
  id: string;
  display_name: string;
  discord_handle: string;
};

export function searchPlayers(
  db: Database.Database,
  query: string,
  limit = 5,
): PlayerSearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const like = `%${trimmed.toLowerCase()}%`;
  return db
    .prepare(
      `SELECT id, display_name, discord_handle
         FROM players
        WHERE LOWER(display_name) LIKE ?
           OR LOWER(discord_handle) LIKE ?
        ORDER BY display_name
        LIMIT ?`,
    )
    .all(like, like, limit) as PlayerSearchHit[];
}
```

Notes:

- LIKE with `%...%` is case-insensitive via the `LOWER()` wrap;
  SQLite's default LIKE is case-insensitive for ASCII anyway, but
  the explicit `LOWER` covers Unicode + future Postgres migration.
- `trim()` + length-0 short-circuit means typing whitespace alone
  returns nothing (no result spam).
- Hard-cap at 5 by default — matches Q-H5-8.
- No SQL injection risk: parameter binding.

### `PATCH /api/racing/drivers/[driverId]`

New file `app/api/racing/drivers/[driverId]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { setDriverPlayer } from '@/lib/db/rc';
import { canEditRace, type SessionPlayer } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  player_id: z.string().min(1).nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ driverId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp: SessionPlayer = { id: session.user.id, role: session.user.role };
  if (!canEditRace(sp)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { driverId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const result = setDriverPlayer(db(), driverId, parsed.data.player_id);
  switch (result.status) {
    case 'no_driver':
      return NextResponse.json({ error: 'driver not found' }, { status: 404 });
    case 'no_player':
      return NextResponse.json({ error: 'player not found' }, { status: 400 });
    case 'ok':
      return NextResponse.json({ status: 'ok', player_id: parsed.data.player_id });
  }
}
```

Reuses `canEditRace` per Q-H5-11. 400 for missing player (not 404)
because the operator's request body was malformed-by-FK; the route
URL itself (`/drivers/<driverId>`) is valid (driver exists).

### `DriverPlayerLink` component

```tsx
'use client';

type Props = {
  driverId: string;
  currentLink: { id: string; display_name: string; discord_handle: string } | null;
};

export function DriverPlayerLink({ driverId, currentLink }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSearchHit[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const resp = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`);
      if (resp.ok) setResults(await resp.json());
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const submit = (playerId: string | null) =>
    start(async () => {
      setErr(null);
      const resp = await fetch(`/api/racing/drivers/${driverId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        setErr((data && data.error) ?? 'failed');
        return;
      }
      setQuery('');
      router.refresh();
    });

  return (
    <div className="mt-2 rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-slate-400">Admin · link Discord player</p>
      {currentLink ? (
        <div className="mt-2 flex items-center justify-between">
          <span>Linked to {currentLink.display_name} (@{currentLink.discord_handle})</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(null)}
            className="h-tap min-w-tap rounded-md bg-red-700 px-3 py-1 text-xs font-medium text-white"
          >
            Unlink
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            inputMode="text"
            placeholder="Search by handle or display name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-2 h-tap w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm"
          />
          {results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => submit(r.id)}
                    className="flex h-tap w-full items-center justify-between rounded-md border border-slate-800 bg-slate-950 px-3 text-left text-sm hover:bg-slate-800"
                  >
                    <span>{r.display_name}</span>
                    <span className="text-xs text-slate-400">@{r.discord_handle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}
```

The component calls a small new route `GET /api/players/search?q=...`
which wraps `searchPlayers` server-side. Auth-gated to `global_admin`
(same `canEditRace` predicate) so unauthenticated browsers can't
enumerate the player table.

**Side-route addition:** `app/api/players/search/route.ts` (new) —
~15 LOC. GET-only, returns `searchPlayers(db, q, 5)`. Auth gate +
`q` length cap of 64 chars to bound the SQL parameter.

Updated files-I'll-change to include this:

| File | Status | Change |
|---|---|---|
| `app/api/players/search/route.ts` | new | GET `?q=...`. Auth-gates to `canEditRace` (global_admin). Returns `searchPlayers(db, q, 5)`. |

### Driver profile page wiring

In `app/racing/drivers/[driverId]/page.tsx`:

- Replace the inline `linkedPlayer` query (page.tsx:24-30) with
  `getDriverWithLinkedPlayer(db(), driverId)`.
- After the existing "Linked to" / "No Discord linkage" paragraph,
  render `<DriverPlayerLink>` if `session?.user?.role ===
  'global_admin'` — the server page reads `auth()` and passes
  `currentLink` (or null) into the client component.

```tsx
{isAdmin && (
  <DriverPlayerLink
    driverId={driver.id}
    currentLink={
      driver.player_id
        ? {
            id: driver.player_id,
            display_name: driver.linked_display_name!,
            discord_handle: driver.linked_discord_handle!,
          }
        : null
    }
  />
)}
```

The `!` non-null asserts are safe: when `player_id` is set, the
LEFT JOIN guarantees both names are set (or the FK is broken — a
state H5 shouldn't try to repair).

---

## Phase D — 3-up compare table

### `CompareDriversSection` component

Lives on the race detail page between admin panel and lap-by-lap.
Receives:

```ts
type Props = {
  drivers: Array<{
    driverId: string;
    displayName: string;
    bestLapMs: number | null;
    stats: DriverStats;   // pre-computed server-side
  }>;
};
```

Server-side, the page pre-computes `computeDriverStats` for every
driver in the standings (it already does this in the lap-by-lap
loop — refactor to compute once into a map, pass into both the
existing details panels AND the compare component). Avoids re-doing
the math client-side.

Client-side state:

```tsx
'use client';

export function CompareDriversSection({ drivers }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = (searchParams.get('compare') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((id) => drivers.some((d) => d.driverId === id))
    .slice(0, 3);
  const [selected, setSelected] = useState<string[]>(initial);

  useEffect(() => {
    const qs = selected.length > 0 ? `?compare=${selected.join(',')}` : window.location.pathname;
    router.replace(qs, { scroll: false });
  }, [selected, router]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length < 3) return [...prev, id];
      return [...prev.slice(1), id];   // drop the oldest (FIFO)
    });
  };

  const picked = selected
    .map((id) => drivers.find((d) => d.driverId === id))
    .filter((d): d is Props['drivers'][number] => !!d);

  return (
    <section className="mt-6">
      <h2 className="text-lg font-medium">Compare drivers</h2>
      <p className="mt-1 text-xs text-slate-500">
        Pick 2–3 drivers to compare side-by-side. Long-press is not used here; tap to toggle.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {drivers.map((d) => {
          const on = selected.includes(d.driverId);
          return (
            <li key={d.driverId}>
              <button
                type="button"
                onClick={() => toggle(d.driverId)}
                className={
                  'h-tap min-w-tap rounded-full border px-3 text-xs ' +
                  (on
                    ? 'border-blue-400 bg-blue-500/20 text-blue-100'
                    : 'border-slate-800 bg-slate-900 text-slate-200')
                }
              >
                {d.displayName}
              </button>
            </li>
          );
        })}
      </ul>
      {picked.length < 2 ? (
        <p className="mt-3 text-xs text-slate-500">
          Select at least 2 drivers above to see the comparison.
        </p>
      ) : (
        <CompareTable picked={picked} />
      )}
    </section>
  );
}
```

`<CompareTable>` renders the side-by-side table:

| Stat        | Driver A          | Driver B          | Driver C          |
| ----------- | ----------------- | ----------------- | ----------------- |
| Best        | `00:01.892`       | `00:01.945`       | `00:02.011`       |
| Average     | `00:02.103`       | `00:02.078`       | `00:02.205`       |
| Top 3 avg   | ...               | ...               | ...               |
| Top 5 avg   | ...               | ...               | ...               |
| Median      | ...               | ...               | ...               |
| Consistency | `± 00:00.080`     | `± 00:00.062`     | `± 00:00.090`     |
| First lap   | ...               | ...               | ...               |
| Counted     | `15`              | `14`              | `15`              |

Stat label rows are stacked; column widths grow with column count.
On mobile the table needs to fit 3 columns into ~360px — a 2-column
table is comfortable; a 3-column table requires the value column to
drop to `text-xs` (already the case). The lap-by-lap tables already
fit 4 columns at this width, so 3 columns of formatted-lap-ms
values fits.

```tsx
function CompareTable({ picked }: { picked: Props['drivers'] }) {
  const rows: Array<{ label: string; value: (s: DriverStats) => string }> = [
    { label: 'Best', value: (s) => optional(s.bestMs) },
    { label: 'Average', value: (s) => optional(s.avgMs) },
    { label: 'Top 3 avg', value: (s) => optional(s.top3AvgMs) },
    { label: 'Top 5 avg', value: (s) => optional(s.top5AvgMs) },
    { label: 'Median', value: (s) => optional(s.medianMs) },
    {
      label: 'Consistency',
      value: (s) => (s.consistencyMs == null ? '—' : `± ${formatLapMs(s.consistencyMs)}`),
    },
    { label: 'First lap', value: (s) => optional(s.firstLapMs) },
    { label: 'Counted', value: (s) => String(s.countedLaps) },
  ];
  return (
    <table className="mt-3 w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="py-1 pr-2 font-normal">Stat</th>
          {picked.map((d) => (
            <th key={d.driverId} className="py-1 pr-2 text-right font-normal">
              <span
                aria-hidden
                className="mr-1 inline-block h-2 w-2 rounded-full"
                style={{ background: driverColor(d.driverId) }}
              />
              {d.displayName}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-slate-800">
            <td className="py-1 pr-2 text-slate-400">{r.label}</td>
            {picked.map((d) => (
              <td key={d.driverId} className="py-1 pr-2 text-right font-mono tabular-nums">
                {r.value(d.stats)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### URL sync rationale

`router.replace(?compare=...)` instead of `router.push(...)`:

- `push` would add a history entry per toggle — a 5-toggle session
  would litter the back stack.
- `replace` updates the URL in place; the back button still goes to
  the previous page.
- `scroll: false` keeps the page from jumping when the URL updates
  (the default `router.replace` scrolls to top).

The `useEffect` syncs URL ← state. The initial state is read from
the URL on mount. No `useEffect` → `setSelected` loop because the
URL is only written, never re-read, after mount.

### Edge: drivers in the URL that don't exist in this race

If someone shares `?compare=a,b,c` and one of those ids isn't in
this race's driver set, the `initial` filter drops it. The URL is
then "lying" (`?compare=a,b,c` but `c` was filtered out). The first
`useEffect` run rewrites the URL to match the cleaned state — by
the time the user inspects the URL, it reflects what's actually
selected. Acceptable.

---

## Three must-work flows

### Flow 1 — Compare 3 drivers in a 10-driver race

Operator opens `/racing/<raceId>` on a laptop. Sees the chart
stretched across 2/3 of an 896px container, standings on the right
1/3. Scrolls past the admin panel. Sees "Compare drivers" with 10
chips. Taps three: A, B, C — table renders below with three columns.
Taps a fourth (D): A is replaced (FIFO); table now shows B, C, D.
The URL updates from `?compare=A,B,C` to `?compare=B,C,D`. Copies
the URL, pastes into Discord. The colleague who clicks the link sees
the same comparison on first paint.

### Flow 2 — Isolate driver 5 in the lap chart

Same race. Ten polylines overlap heavily. Operator long-presses
driver 5's chip in the chart legend. After 500ms, the chart re-renders
with only driver 5's polyline. The other 9 chips dim to
`opacity-40 border-dashed`. To bring driver 3 back into view, the
operator taps driver 3's chip — driver 3's polyline appears alongside
driver 5's; driver 3's chip returns to solid border. To restore all
drivers, the operator refreshes the page (no "show all" button in
H5 — see Hand-offs).

### Flow 3 — Link RC driver to Discord player

Operator (global_admin) opens
`/racing/drivers/<driverId>` on a phone. Sees "No Discord linkage —
RC-local profile." Below it: "Admin · link Discord player" section
with a text input. Types "bran". The component debounces 200ms,
then queries `/api/players/search?q=bran`. Top-5 results render
below the input — one is "Brandon (@brandonw)". Operator taps the
result. The client PATCHes `/api/racing/drivers/<driverId>` with
`{player_id: "<player-uuid>"}`. Server validates the FK, updates
`rc_drivers.player_id`, returns 200. `router.refresh()` re-renders
the page — the "Linked to @brandonw" line now appears, and the
admin section shows an Unlink button instead of the search input.
Tapping Unlink PATCHes with `{player_id: null}`; page refreshes;
back to "No Discord linkage".

---

## Test plan

~20 new tests across unit + integration. Vitest, ephemeral SQLite
per file (no DB mocks). Component tests use vitest-only DOM
assertions (no React Testing Library — the repo doesn't have one
wired). Where a tap+pointer simulation isn't cleanly doable in
vitest, document as a manual smoke test.

### Unit tests

1. **`tests/unit/rc-admin-edits.test.ts`** (edit, +4)
   - `setDriverPlayer` happy: pass a valid `(driverId, playerId)` →
     status 'ok'; assert `rc_drivers.player_id` is set.
   - `setDriverPlayer` no_driver: pass a bogus driverId → 'no_driver';
     assert no rows mutated.
   - `setDriverPlayer` no_player: pass a valid driverId + bogus
     playerId → 'no_player'; assert `rc_drivers.player_id` is
     unchanged.
   - `setDriverPlayer` null-clears: set a link, then call with
     `playerId = null` → 'ok'; assert `rc_drivers.player_id` is
     NULL.

2. **`tests/unit/queries.test.ts`** (new, +6)
   - `searchPlayers` by `display_name` substring: "bran" matches
     "Brandon".
   - `searchPlayers` by `discord_handle` substring: "brand" matches
     `@brandonw`.
   - Case-insensitive: "BRAN" matches "Brandon".
   - Limit cap: with 20 matching players, default `limit = 5`
     returns 5; passing `limit = 10` returns 10.
   - Empty query: `searchPlayers(db, '')` returns `[]`. So does
     `searchPlayers(db, '   ')` (whitespace trim).
   - No matches: `searchPlayers(db, 'zzzzzz')` returns `[]`.

3. **`tests/unit/compare-drivers-section.test.ts`** (new, +5)
   - The component is server-renderable to HTML via Next.js's
     `renderToString` or vitest's `JSDOM`-based pattern (existing
     tests in the repo). Drive state via a small headless harness:
     instantiate with `drivers=[A, B, C, D]`, simulate `toggle(id)`
     through the public callback exposed for tests, assert resulting
     `selected` state.
   - 0 selected → renders "Select at least 2 drivers" empty state.
   - 1 selected → still renders the empty state (need ≥2).
   - 2 selected → renders a 2-column table; assert column headers
     match selected display names.
   - 3 selected → renders a 3-column table.
   - 4th toggle replaces the oldest: starting at `[A,B,C]`, toggle
     `D` → `selected === ['B','C','D']`.
   - URL persistence: initialise with
     `URLSearchParams({compare: 'A,B,C'})` → initial `selected ===
     ['A','B','C']`. If component-internal hook usage makes URL
     read hard to test in vitest, mock via a context-prop seam:
     `initialSelected?: string[]` for test injection only (marked
     `@internal`).
   - Manual smoke test (documented): toggling triggers
     `router.replace` (untestable without a Next.js router mock).

4. **`tests/unit/lap-chart-visibility.test.ts`** (new, +3)
   - Render `LapChart` with 3 drivers and `visibleDriverIds = new
     Set([id1])`. Snapshot the SVG and assert only one `<polyline>`
     element is present.
   - Render with no `visibleDriverIds` prop. Assert 3 `<polyline>`
     elements.
   - Chip styling: hidden chips have `opacity-40` in className;
     visible chips do not.

5. **Long-press handler** — documented as a manual smoke test.
   Reason: simulating `setTimeout` + pointer event ordering in
   vitest without React Testing Library is brittle. The handler
   logic is straightforward; a manual two-finger test in a browser
   covers it. (If RTL is added later, this becomes a normal
   component test.)

### Integration tests

6. **`tests/integration/rc-admin-edits.test.ts`** (edit, +5)
   - `PATCH /api/racing/drivers/<driverId>` 401: no session →
     `{error: 'unauthenticated'}`, status 401.
   - 403: non-`global_admin` session → `{error: 'forbidden'}`, 403.
   - 404: valid admin session, bogus `driverId` → `{error: 'driver
     not found'}`, 404.
   - 400 missing player: valid admin session + real driver + bogus
     `player_id` → `{error: 'player not found'}`, 400.
   - 200 link + 200 null-clear: PATCH with a valid player_id →
     200 `{status: 'ok', player_id}`; subsequent
     `getDriverWithLinkedPlayer` returns the joined display_name +
     discord_handle. Second PATCH with `{player_id: null}` → 200;
     `getDriverWithLinkedPlayer` returns `linked_*: null`.

7. **`tests/integration/rc-queries.test.ts`** (edit, +1)
   - `getDriverWithLinkedPlayer`: insert a driver, link to a
     player, assert the row has `linked_display_name` +
     `linked_discord_handle` set. Insert a second driver without a
     link, assert the row has both `linked_*` fields = null.

### Test-count expectation

4 + 6 + 5 + 3 + 5 + 1 = **24 new tests** (plus 1 documented manual
smoke). Slightly above the prompt's ~20 target — splitting the
queries.test.ts file off accounts for the overage; happy to fold
into an existing file if the reviewer pushes back.

No existing test should break. The Phase A class change is invisible
to JSDOM snapshots that don't assert on `className`. The Phase B
`LapChart` change is additive — `visibleDriverIds` defaulted to "all
visible" preserves today's behaviour for callers that don't pass it.

---

## Quality bar

- No comments unless WHY is non-obvious. Pinned comments worth
  keeping: the `longPressFired` ref reason, the 5px movement
  tolerance (`> 25` = `> 5²`), and the URL-write-only `useEffect`
  rationale.
- No mocks at the DB boundary. Ephemeral SQLite per test file.
- TypeScript strict; no `any` without a `// reason:` line.
- ESLint + Prettier + typecheck + build clean.
- Mobile-first: every new UI surface keeps 44px tap targets. The
  compare chips, the player-search input, and the long-press chips
  all use `h-tap min-w-tap`. Desktop layout improvements are
  progressive enhancement — mobile renders the same number of
  elements with the same touch targets.

---

## Verification

After implementation:

1. `python3 scripts/align.py check` exits 0. No symbol change (per
   Q-H5-14).
2. `cd wizard && python3 -m pytest -q` — still 104 passing. H5
   makes zero wizard edits.
3. `cd eloup-web && pnpm test && pnpm lint && pnpm typecheck && pnpm build` clean.
4. `docker build` succeeds.
5. **Do NOT run the wizard. Do NOT push to remote. Do NOT call any
   prod API.** Operator handles deploy after implementation review.

---

## Out of scope for H5 (do NOT build)

- **"Δ to selected reference" chart view.** R2 territory.
- **Auto-link by name.** Admin must manually pick from search
  results. The TXT-vs-JSON dedup story is already enough
  name-matching for one project.
- **Bulk-link UI.** Per-driver only.
- **ELO writes when linking.** Phase C only writes `player_id`.
  Future ELO transactions read this field; H5 doesn't change any
  rating logic.
- **Wizard changes.**
- **Migrations.** `rc_drivers.player_id` is already a nullable FK.
- **"Show all drivers" button on the chart.** A refresh resets the
  visibility state. Adding a reset button is a small follow-up;
  not on the critical path.
- **Multi-race compare.** Compare is scoped to one race. Cross-race
  compare is bigger work.
- **Compare table sorting / per-stat winner highlight.** The 3-up
  table is a passive renderer in H5. Highlighting the column with
  the best Best Lap (and so on) is a nice-to-have.

---

## Commit shape (mirrors H2 / H3 / H4)

Five commits expected:

1. `docs: H5 — race-detail QoL task doc` — this file only.
   **STOP after this commit and request review.**
2. `docs: H5 — reviewer report` — landed by a different agent in
   `Agents/Review-reports/h5-race-detail-qol-review.md` referencing
   this filename.
3. `docs: H5 — fold reviewer findings, flip task to In Progress` —
   ONLY if review flags MAJOR-grade changes that require a doc
   update before implementation. Otherwise skip and absorb the
   reviewer's notes inline in commit 4.
4. `feat: eloup-web — H5 race-detail QoL (desktop, toggle, link, compare)`
   — all four phases + tests in one commit. Splitting per-phase
   would be cleaner but the H4 precedent bundled API+UI; consistency
   matters. The implementer MAY split into 2 feature commits at
   their discretion if the diff is large (e.g., A+B in one, C+D in
   another).
5. `docs: H5 — mark task Complete` — flip Status, verification
   results in the commit body.

Each commit ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Hand-offs

After H5 ships:

- **R2 (RC ELO)** can now read `rc_drivers.player_id`. When non-null,
  ELO deltas write to `players.overall_rating` (or a synthetic
  `rc_ratings` table — R2's call per the R1 hand-off matrix). The
  admin UI built in Phase C is the canonical way to populate the
  link; bulk auto-link is explicitly deferred to R2 or later.
- **Compare-history sharing.** URL-persisted selections mean an
  admin can bookmark / paste a specific comparison view into Discord.
  Useful pattern that extends to other admin surfaces (the standings
  filter, the track filter, etc.) — if shareability becomes a theme,
  the same `useSearchParams` + `router.replace` pattern is the
  template.
- **Multi-track / cross-race compare** — currently the compare is
  scoped to one race. A cross-race compare (e.g. "all of Brandon's
  best laps on Outdoor Long, side by side with Willy's") is bigger
  work; flag for a future H6 or R2 design.
- **"Show all drivers" chart reset button** — currently the only way
  to restore all chips to visible is a page refresh. A small
  "Show all" affordance is one button + a `setVisible(new Set(all))`
  call. Trivial to add; left out of H5 to keep the surface minimal.
- **Compare table per-stat winner highlight.** The 3-up table is a
  passive renderer. Highlighting the column with the lowest Best /
  highest Counted / etc. would be a small enhancement; if the
  operator asks for it after using the table at an event, ship as
  H6.
- **Player-search route hardening.** `GET /api/players/search` is
  admin-gated. If the operator later wants to allow regular users
  to search (for self-claim of an RC driver), the gate widens; the
  route itself is read-only and safe.

---

## Clarifying questions surfaced while writing this doc

Flagging for the reviewer:

1. **Symbol update needed?** I picked "no" (Q-H5-14) because the
   `racing` symbol describes the domain at a coarse grain — neither
   the compare cap nor the existence of a UI for an already-typed
   column is at that grain. But: if the project convention is to
   document any new admin surface in the symbol, I'd add
   `admin_surfaces: ['upload', 'edit', 'penalty', 'delete', 'link']`
   (or similar) and re-run `align.py lock`. Reviewer's call.

2. **`searchPlayers` lives in `lib/db/queries.ts`, not `lib/db/players.ts`.**
   The prompt's file plan says "extend the existing `lib/db/players.ts`
   module". On inspection, `lib/db/players.ts` is the Discord
   bootstrap module (`bootstrapPlayer`), and the player-query
   helpers (`findPlayerByDiscordId`, `leaderboardForGame`,
   `overallLeaderboard`) live in `lib/db/queries.ts`. I placed
   `searchPlayers` there for proximity to the existing player-row
   reads. If the reviewer prefers a strict "one player module"
   convention, I'd hoist `findPlayerByDiscordId` etc. into
   `players.ts` first — but that's a refactor with no
   functional change. Leaning toward "land `searchPlayers` in
   `queries.ts`, leave the rest as-is".

3. **Side-route `GET /api/players/search`.** The prompt scopes
   Phase C to a PATCH on `/api/racing/drivers/[driverId]`. The
   client search UI needs a server-side route to call (the SQL
   can't run from the browser). I added `GET /api/players/search`
   as a sibling — auth-gated to `canEditRace` so the player table
   isn't enumerable by anonymous browsers. Reviewer's call: keep
   it admin-gated, or open to authenticated users only, or move
   the search into a Server Action on the driver page (no separate
   route). I lean admin-gated GET — the simplest shape that
   covers the use case without leaking data.

4. **URL-persistence write strategy.** I use a `useEffect` that
   writes the URL whenever `selected` changes. If the operator
   navigates *away* via a Link click while the URL is dirty,
   `router.replace` may interleave with the navigation. In
   practice the navigation wins (the page unmounts before the
   replace flushes) — but if the reviewer wants tighter control,
   I'd switch to a synchronous `router.replace` inside the
   `toggle` callback. Marginal call; the `useEffect` form is
   easier to read.

5. **Compare empty state when only 1 driver in this race.** A race
   with 1 driver renders 1 chip; the operator can never reach the
   ≥2-selected state. The current copy says "Select at least 2";
   it works but is mildly weird. If the reviewer wants me to hide
   the entire compare section when `drivers.length < 2`, I can.
   Leaning "leave it; 1-driver races are a real edge case (DNS / no-show)
   and the empty state is informational, not broken."

6. **Long-press accessibility.** Keyboard users can't long-press.
   For keyboard accessibility, the chips need a "Shift+Enter" or
   similar to isolate. Out of scope for H5 (the existing keyboard
   path → tap-toggle works to hide every other driver one by one,
   which gets to the same end state). Flagging as a hand-off.
