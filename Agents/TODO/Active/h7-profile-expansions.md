# H7 — Profile expansions: game categories + RC win/loss

## Author: claude-opus-4.7-h7-implementer
## Status: In Progress

## Reviewer findings folded (2026-05-18)

The reviewer report (`Agents/Review-reports/h7-profile-expansions-review.md`,
APPROVE-WITH-CHANGES, claude-sonnet-4-6-h7-reviewer) surfaced two MAJOR + three
MINOR + two NIT findings. Folded as follows:

- **MAJOR #1 — Test 5 arithmetic.** Original draft pasted `21200` (Flow 1's
  three-game numerator) into the two-game test 5 fixture. Correct math:
  `1300×10 + 1500×4 = 19000`; `ROUND(19000/14) = 1357`. Test asserts `1357`.
- **MAJOR #2 — Career stats markup.** The planned `<dl>` + `grid-cols-4`
  wraps 5 children into a broken layout. Phase E now renders a `<table>`
  with `<thead>` / `<tbody>` instead. Semantically correct for tabular data.
- **MINOR #5 — POST auth status code.** Existing `POST /api/games`
  returns `403` for unauthenticated callers because `canCreateGame(null)`
  is false. Added the `player ? 403 : 401` branch to the POST handler in
  Phase C so the new PATCH and existing POST agree on auth-vs-forbidden
  semantics.
- **CQ4 cross-reference.** Added comments between `playerCategoryRatings`
  and `playerGameRatings` documenting the intentional zero-match asymmetry.
- **MINOR #3 / #4** (split rounding between SQL `ROUND` and JS
  `Math.round`): keeping SQL `ROUND` for the rollup. The tests pin the
  specific SQLite banker-rounding behavior with an explicit fixture
  (test 7: `current_rating = 1350.5, games_played = 1 → 1350`). The
  per-game list separately runs through `Math.round` in the JSX. The
  pages where these two values appear are different sections of the
  profile so the rare half-tie won't sit side-by-side; the test pins
  the contract.
- **NIT #6 / #7** absorbed as inline notes — use `reduce` for
  `groupByCategory`, accept the existing `resp.text().catch(...)` error
  pattern.

The CQ positions (CQ1 default `'other'`, CQ2 `z.enum`, CQ3 rating DESC,
CQ4 asymmetric zero-match, CQ5 `<table>`, CQ6 `game_categories_count`,
CQ7 no UPDATE backfill) are all locked.

> **Author/Reviewer separation note.** Prior implementers are
> `claude-opus-4.7-{planner,m2,m3,m4,m5,h1,r1,h2,h3,h4,h5,h6}-implementer`;
> prior reviewers are `claude-sonnet-4-6-{m2,m3,m4,m5,h1,r1,h2,h3,h4,h5,h6}-reviewer`
> (plus the early `claude-sonnet-4-6-reviewer`). The reviewer for this
> doc must use a `## Reviewer:` field distinct from
> `## Author: claude-opus-4.7-h7-implementer`. Suggested:
> `claude-sonnet-4-6-h7-reviewer`.
>
> The reviewer should land their report at
> `Agents/Review-reports/h7-profile-expansions-review.md` referencing
> `h7-profile-expansions.md` in the body. Until then, the review gate
> blocks edits to `eloup-web/`.

---

## Why this task exists

M4 shipped a profile page at `/profile` with three sections: Overall
ELO, Per-game ratings, and Recent matches. R1/H5 shipped an RC driver
profile at `/racing/drivers/[driverId]` with best-lap-per-track and
recent races. Two operator observations after recent parties:

1. **Per-game ELO is a flat list and that's noisy with 20+ games.**
   At a party with 8 racing games and 12 yard/bar games, the operator
   wants to see "how am I doing at *racing* overall?" rather than
   reading 8 lines of polo / forza / mario kart / rrr. The fix: tag
   each game with a category and roll up per-category ELO as a
   weighted average across the games in that category. Pre-aggregated
   numbers live in `ratings.current_rating`; no new table needed.

2. **RC driver profiles have no win/loss summary.** The page shows
   "Best lap per track" and "Recent races" but the operator can't see
   "how many wins does this driver have?" at a glance. Qualifying and
   practice rankings differ from race wins (H6's split), so the
   summary needs per-race-kind segmentation in addition to a totals
   line.

Bundling both into H7 because:

- Both are profile-page expansions — same review focus (data
  surface, no new write paths, no auth changes).
- Both add aggregation helpers (`playerCategoryRatings`,
  `driverWinLossStats`) without new schema beyond the single
  `games.category` column.
- Both ship with the same admin-UX shape (category dropdown on
  `/games`, no UX change needed on `/racing/drivers/*` — read-only).

---

## Operator decisions (locked in — do not relitigate)

| # | Question | Decision |
|---|---|---|
| Q-H7-1 | Category storage | `games.category TEXT NOT NULL DEFAULT 'other'`. NO SQL CHECK constraint. |
| Q-H7-2 | Category validation | App-side via `isKnownCategory` in `lib/games/categories.ts`. Adding a new category = 1-line code change; no migration. |
| Q-H7-3 | Default category list | 8: `racing`, `fighting`, `shooting`, `yard`, `bar`, `tabletop`, `video`, `other`. Lowercase slugs in DB; Title-Cased labels in UI. |
| Q-H7-4 | Backfill of existing rows | All existing `games` rows get `category = 'other'` from the DEFAULT. Operator updates via the `/games` per-row edit affordance post-deploy. |
| Q-H7-5 | Per-category ELO rollup | Weighted average — `SUM(current_rating × games_played) / SUM(games_played)`, grouped by `games.category`. Computed on the fly in `lib/db/queries.ts`. NO new `category_ratings` table. |
| Q-H7-6 | Zero-match game handling | Excluded from rollup (`WHERE r.games_played > 0`). Avoids the 1200 starter rating polluting the weighted average. |
| Q-H7-7 | RC win/loss segmentation | Overall + per-race-kind split. Stats per row: total races, wins (placement = 1), podiums (placement ≤ 3). |
| Q-H7-8 | Storage for win/loss | Computed via aggregation query against `rc_race_drivers` + `rc_races`. No new column. |
| Q-H7-9 | RC win/loss row order | Deterministic: `race`, `qualif`, `practice`, then the `all` totals row. |
| Q-H7-10 | POST `/api/games` body — required or default category | **Optional with DEFAULT 'other'.** Justification: existing API clients (none yet beyond the form) shouldn't break; the schema default is `'other'`; the form sends an explicit category but a curl call without it lands as `'other'`. Validates `category` via `isKnownCategory` when present; rejects unknown values with 400. |
| Q-H7-11 | PATCH `/api/games/[gameId]` body | `{ category: string }` only (H7 scope). Other fields are out of scope — admin would re-create the game to change format/min/max/K. |
| Q-H7-12 | Permission helper | Reuse `canCreateGame` (`global_admin` only) for POST AND PATCH. Same predicate used in M4's `/api/games` POST. |
| Q-H7-13 | Symbol updates | Optional. Decision: **add `game_categories_count: 8` to the `app` symbol's `properties`.** Surfaces the count at align.py time so a future operator can see the symbol drift if categories grow. Re-run `align.py lock`. |
| Q-H7-14 | Wizard changes | None. |
| Q-H7-15 | Migration count | One — `0008_games_category.sql`. |

---

## Files I'll change

Under `eloup-web/`:

| File | Status | Change |
|---|---|---|
| `lib/db/migrations/0008_games_category.sql` | new | `ALTER TABLE games ADD COLUMN category TEXT NOT NULL DEFAULT 'other'; CREATE INDEX idx_games_category ON games(category);`. Idempotent via `schema_migrations`. |
| `lib/games/categories.ts` | new | `GAME_CATEGORIES` const array (8 entries), `GameCategorySlug` type, `categoryLabel`, `isKnownCategory`, `GAME_CATEGORY_SLUGS` exported tuple for zod use. |
| `lib/db/queries.ts` | edit | (1) Add `category` to `GameRow`. (2) Add `playerCategoryRatings(db, playerId): CategoryRollup[]` (Q-H7-5). (3) Add `playerGameRatings(db, playerId): GameRating[]`. |
| `lib/db/rc.ts` | edit | Add `driverWinLossStats(db, driverId): DriverWinLossRow[]` returning rows in Q-H7-9 order. |
| `components/NewGameForm.tsx` | edit | Add a category `<select>` (default `'other'`), submit body includes `category`. |
| `components/GameCategoryEditor.tsx` | new | Client component. Renders a `<select>` with the current category preselected + a Save button. PATCHes `/api/games/[gameId]`. Per-row in the catalog list. |
| `app/games/page.tsx` | edit | Pass `currentCategory` to a new `<GameCategoryEditor>` rendered inline on each catalog row. Add a "Category" column to the right side of the row. |
| `app/api/games/route.ts` | edit | POST body schema now accepts optional `category`. Validates via `isKnownCategory` (zod `z.enum(GAME_CATEGORY_SLUGS).default('other')`). Returns 400 on unknown values. INSERT includes the `category` column. |
| `app/api/games/[gameId]/route.ts` | new | PATCH `{ category }`. Auth: `canCreateGame` (global_admin). 401 / 403 / 404 / 400 envelope. Returns 200 with the updated row. |
| `app/profile/page.tsx` | edit | (1) NEW "By category" section between Overall and Per-game — uses `playerCategoryRatings`. (2) Replace flat per-game list with grouped-by-category using `playerGameRatings`. Empty categories hidden. |
| `app/racing/drivers/[driverId]/page.tsx` | edit | Below the "Linked to" / admin-link section, render a "Career stats" block: 4 rows (`race`, `qualif`, `practice`, `all`) each with total / wins / podiums. |
| `tests/unit/categories.test.ts` | new | `isKnownCategory` happy + reject paths; `categoryLabel` returns expected labels. |
| `tests/unit/queries.test.ts` | edit | Add `playerCategoryRatings` cases — multi-game category, single-game category, zero-match game excluded, weighted-average correctness, rounding behavior on ties. Add `playerGameRatings` cases — returns category + rating + games_played, ordered alphabetically by category then game name. |
| `tests/unit/rc-driver-winloss.test.ts` | new | `driverWinLossStats` fixture: mix of race kinds and placements; totals row aggregates correctly; row order matches Q-H7-9. |
| `tests/integration/games-api.test.ts` | new | POST `/api/games` with valid category, with omitted category (defaults to 'other'), with invalid category (400). PATCH `/api/games/[id]` 401 / 403 / 404 / 400-invalid / 200-valid. |
| `tests/integration/rc-queries.test.ts` | edit | Add `driverWinLossStats` integration coverage: seeded driver with known race outcomes, assert wins / podiums counts. |
| `tests/unit/migrate.test.ts` | edit | Add 0008 idempotency case: column exists with `NOT NULL` and DEFAULT `'other'` after two migrate runs; backfilled `games` rows have `category = 'other'`. |

Outside `eloup-web/`:

| File | Status | Change |
|---|---|---|
| `symbols/manifest.json` | edit | Add `app.properties.game_categories_count: 8`. |
| `symbols/manifest.lock` | regen | `python3 scripts/align.py lock` after manifest edit. |

No docs/, no wizard, no other migrations.

---

## Phase A — Schema migration 0008

```sql
-- 0008_games_category.sql — Tag each game with a category for the
-- profile per-category ELO rollup. App-side validation via
-- lib/games/categories.ts decides which slugs are valid; the DB
-- accepts any TEXT so adding a category is a 1-line code change with
-- no migration. Existing rows get 'other' via the DEFAULT. See
-- Agents/TODO/Active/h7-profile-expansions.md.

ALTER TABLE games
  ADD COLUMN category TEXT NOT NULL DEFAULT 'other';

CREATE INDEX idx_games_category ON games(category);
```

Idempotent via `schema_migrations` (same pattern as 0005 / 0006). No
CHECK constraint per Q-H7-1.

---

## Phase B — Categories constants module

`lib/games/categories.ts`:

```ts
export const GAME_CATEGORIES = [
  { slug: 'racing',   label: 'Racing'   },
  { slug: 'fighting', label: 'Fighting' },
  { slug: 'shooting', label: 'Shooting' },
  { slug: 'yard',     label: 'Yard'     },
  { slug: 'bar',      label: 'Bar'      },
  { slug: 'tabletop', label: 'Tabletop' },
  { slug: 'video',    label: 'Video'    },
  { slug: 'other',    label: 'Other'    },
] as const;

export type GameCategorySlug = (typeof GAME_CATEGORIES)[number]['slug'];

export const GAME_CATEGORY_SLUGS = GAME_CATEGORIES.map((c) => c.slug) as readonly GameCategorySlug[];

export function isKnownCategory(slug: string): slug is GameCategorySlug {
  return GAME_CATEGORIES.some((c) => c.slug === slug);
}

export function categoryLabel(slug: string): string {
  const found = GAME_CATEGORIES.find((c) => c.slug === slug);
  return found?.label ?? slug;
}
```

Notes:

- `as const` + `(typeof ...)[number]['slug']` keeps `GameCategorySlug`
  a string-literal union (`'racing' | 'fighting' | ...`).
- `GAME_CATEGORY_SLUGS` is exported as a `readonly` tuple so zod
  `z.enum(...)` can consume it. zod expects a non-empty array
  literal — `as readonly GameCategorySlug[]` keeps the slug type.
  If zod's `z.enum` is too strict on tuple shape, fall back to
  `z.string().refine(isKnownCategory, 'unknown category')`.
- `categoryLabel(slug)` falls back to the raw slug if unknown — this
  shouldn't happen in practice (DB writes are validated), but a
  legacy row with an unrecognized category renders the slug as-is
  rather than crashing.

---

## Phase C — Admin surface: dropdown + per-row edit on `/games`

### `NewGameForm.tsx`

Add a `category` state (default `'other'`). Render a `<select>` below
the format selector listing all 8 categories. Submit body includes
`category`.

```tsx
const [category, setCategory] = useState<GameCategorySlug>('other');
// ...
body: JSON.stringify({
  name, slug, format,
  min_participants: min,
  max_participants: max,
  default_k: k,
  category,
}),
// ...
<select
  value={category}
  onChange={(e) => setCategory(e.target.value as GameCategorySlug)}
  className="block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
>
  {GAME_CATEGORIES.map((c) => (
    <option key={c.slug} value={c.slug}>{c.label}</option>
  ))}
</select>
```

### `POST /api/games`

Two changes:

1. Body schema gains an optional `category` (below).
2. Auth check moves from a single `403` to `player ? 403 : 401` (reviewer
   MINOR #5). The current handler returns `403` for both unauthenticated
   and unauthorized callers because `canCreateGame(null)` is `false`.
   With H7's new PATCH handler doing the right thing, both methods on
   `/api/games` now agree.

```ts
const session = await auth();
const player = session?.user ? { id: session.user.id, role: session.user.role } : null;
if (!canCreateGame(player)) {
  return NextResponse.json({ error: 'forbidden' }, { status: player ? 403 : 401 });
}
```

Body schema gains an optional `category`:

```ts
const Body = z.object({
  // existing fields…
  category: z.enum(GAME_CATEGORY_SLUGS as [GameCategorySlug, ...GameCategorySlug[]])
    .default('other'),
});
```

The zod cast targets `z.enum`'s expected `[string, ...string[]]` shape.
If TS doesn't accept the cast, use `z.string().refine(isKnownCategory, 'unknown category').default('other')` — same behavior, less type
ceremony.

INSERT becomes:

```ts
db().prepare(
  `INSERT INTO games(id, name, slug, default_k, format,
                     min_participants, max_participants, category)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(id, name, slug, default_k, format, min_participants, max_participants, parsed.data.category);
```

### `GameCategoryEditor.tsx`

```tsx
'use client';

type Props = {
  gameId: string;
  currentCategory: string;
};

export function GameCategoryEditor({ gameId, currentCategory }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<string>(currentCategory);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = value !== currentCategory;

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-tap rounded-md border border-slate-700 bg-slate-900 px-1 text-xs"
      >
        {GAME_CATEGORIES.map((c) => (
          <option key={c.slug} value={c.slug}>{c.label}</option>
        ))}
      </select>
      {dirty && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr(null);
              const resp = await fetch(`/api/games/${gameId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ category: value }),
              });
              if (!resp.ok) {
                setErr(await resp.text().catch(() => `error ${resp.status}`));
                return;
              }
              router.refresh();
            })
          }
          className="h-tap min-w-tap rounded-md bg-blue-500 px-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? '…' : 'Save'}
        </button>
      )}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}
```

Pattern mirrors H5's `DriverPlayerLink` — same `useRouter` +
`useTransition` shape. No debounce (the input is a bounded dropdown,
not a free-text field). Save button only appears when dirty —
operator can't accidentally Save the current value.

### `PATCH /api/games/[gameId]`

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getGame } from '@/lib/db/queries';
import { canCreateGame } from '@/lib/permissions';
import { GAME_CATEGORY_SLUGS, type GameCategorySlug } from '@/lib/games/categories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  category: z.enum(GAME_CATEGORY_SLUGS as [GameCategorySlug, ...GameCategorySlug[]]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const session = await auth();
  const player = session?.user ? { id: session.user.id, role: session.user.role } : null;
  if (!canCreateGame(player)) {
    return NextResponse.json({ error: 'forbidden' }, { status: player ? 403 : 401 });
  }
  const { gameId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', detail: parsed.error.flatten() }, { status: 400 });
  }
  const existing = getGame(db(), gameId);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  db().prepare(`UPDATE games SET category = ? WHERE id = ?`).run(parsed.data.category, gameId);
  return NextResponse.json({ id: gameId, category: parsed.data.category });
}
```

Note on 401 vs 403: `canCreateGame(null) === false` would conflate
"unauthenticated" with "forbidden". The check `player ? 403 : 401`
keeps the envelope distinct (matches H5 `setDriverPlayer` route).

---

## Phase D — Profile page: per-category ELO + per-game breakdown

### `playerCategoryRatings`

```ts
export type CategoryRollup = {
  category: string;
  label: string;
  weightedRating: number;
  gameCount: number;
  totalMatches: number;
};

export function playerCategoryRatings(
  db: Database.Database,
  playerId: string,
): CategoryRollup[] {
  const rows = db
    .prepare(
      `SELECT g.category AS category,
              CAST(ROUND(SUM(r.current_rating * r.games_played) / SUM(r.games_played)) AS INTEGER) AS rating,
              COUNT(*)            AS game_count,
              SUM(r.games_played) AS total_matches
         FROM ratings r
         JOIN games g ON g.id = r.game_id
        WHERE r.player_id = ?
          AND r.games_played > 0
        GROUP BY g.category
        ORDER BY rating DESC`,
    )
    .all(playerId) as Array<{
    category: string;
    rating: number;
    game_count: number;
    total_matches: number;
  }>;
  return rows.map((r) => ({
    category: r.category,
    label: categoryLabel(r.category),
    weightedRating: r.rating,
    gameCount: r.game_count,
    totalMatches: r.total_matches,
  }));
}
```

Notes:

- `WHERE r.games_played > 0` filters zero-match games (Q-H7-6) so a
  starter 1200 doesn't pollute the weighted average.
- `CAST(ROUND(...) AS INTEGER)` gives a deterministic integer-rounded
  value. Tie-breaking in `ROUND` for `.5` cases depends on SQLite's
  rounding mode — SQLite uses banker's rounding (round-half-to-even).
  Tests pin this. UI displays the integer.
- ORDER BY `rating DESC` matches the per-game rating ordering
  convention used elsewhere on the profile.

### `playerGameRatings`

```ts
export type GameRating = {
  gameId: string;
  gameName: string;
  category: string;
  currentRating: number;
  gamesPlayed: number;
};

export function playerGameRatings(
  db: Database.Database,
  playerId: string,
): GameRating[] {
  return db
    .prepare(
      `SELECT g.id   AS game_id,
              g.name AS game_name,
              g.category,
              r.current_rating,
              r.games_played
         FROM ratings r
         JOIN games g ON g.id = r.game_id
        WHERE r.player_id = ?
        ORDER BY g.category, g.name`,
    )
    .all(playerId) as Array<{
    game_id: string;
    game_name: string;
    category: string;
    current_rating: number;
    games_played: number;
  }>
    .map((r) => ({
      gameId: r.game_id,
      gameName: r.game_name,
      category: r.category,
      currentRating: r.current_rating,
      gamesPlayed: r.games_played,
    }));
}
```

(Drop the inline `.map`-on-`as`-cast if TS doesn't like it; split
into two statements.)

Notes:

- Includes zero-match games so the profile lists every game the
  player has had a `ratings` row created for. The category rollup
  query separately filters by `games_played > 0` — that's the
  intended divergence.
- ORDER BY `category, name` so the page can group rows in a single
  pass without a second sort.

### `app/profile/page.tsx`

New section between Overall and the (renamed) Games section:

```tsx
const categoryRollup = playerCategoryRatings(handle, playerId);
const games = playerGameRatings(handle, playerId);

// ...
<section className="mt-6">
  <h2 className="text-sm uppercase tracking-wide text-slate-500">By category</h2>
  {categoryRollup.length === 0 ? (
    <p className="mt-2 text-slate-400">No games played yet.</p>
  ) : (
    <ul className="mt-2 space-y-2">
      {categoryRollup.map((c) => (
        <li
          key={c.category}
          className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
        >
          <span>{c.label}</span>
          <span className="font-mono tabular-nums">
            {c.weightedRating} · {c.gameCount} games · {c.totalMatches} matches
          </span>
        </li>
      ))}
    </ul>
  )}
</section>

<section className="mt-6">
  <h2 className="text-sm uppercase tracking-wide text-slate-500">Games</h2>
  {games.length === 0 ? (
    <p className="mt-2 text-slate-400">No games played yet.</p>
  ) : (
    <div className="mt-2 space-y-3">
      {Object.entries(groupByCategory(games)).map(([slug, rows]) => (
        <div key={slug}>
          <h3 className="text-xs uppercase tracking-wide text-slate-600">
            {categoryLabel(slug)}
          </h3>
          <ul className="mt-1 space-y-1">
            {rows.map((r) => (
              <li
                key={r.gameId}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              >
                <span>{r.gameName}</span>
                <span className="font-mono tabular-nums">
                  {Math.round(r.currentRating)} · {r.gamesPlayed}g
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )}
</section>
```

`groupByCategory(rows)` is a local helper (page-scoped or inline
reduce). Because `playerGameRatings` already returns rows ordered by
category, grouping is a single linear pass.

The existing `Per-game` section header changes to `Games`. The
existing flat list is replaced by the grouped variant above.
Recent-matches section stays as-is.

---

## Phase E — RC driver profile: career stats block

### `driverWinLossStats`

```ts
export type DriverWinLossRow = {
  raceKind: 'race' | 'qualif' | 'practice' | 'all';
  totalRaces: number;
  wins: number;
  podiums: number;
};

export function driverWinLossStats(
  db: Database.Database,
  driverId: string,
): DriverWinLossRow[] {
  const rows = db
    .prepare(
      `SELECT r.race_kind AS race_kind,
              COUNT(*)                                  AS total_races,
              SUM(CASE WHEN rd.placement = 1 THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN rd.placement <= 3 THEN 1 ELSE 0 END) AS podiums
         FROM rc_race_drivers rd
         JOIN rc_races r ON r.id = rd.race_id
        WHERE rd.driver_id = ?
        GROUP BY r.race_kind`,
    )
    .all(driverId) as Array<{
    race_kind: 'race' | 'qualif' | 'practice';
    total_races: number;
    wins: number;
    podiums: number;
  }>;

  const byKind = new Map(rows.map((r) => [r.race_kind, r]));
  const ordered: DriverWinLossRow[] = (['race', 'qualif', 'practice'] as const).map((k) => {
    const r = byKind.get(k);
    return r
      ? { raceKind: k, totalRaces: r.total_races, wins: r.wins, podiums: r.podiums }
      : { raceKind: k, totalRaces: 0, wins: 0, podiums: 0 };
  });
  const totals: DriverWinLossRow = {
    raceKind: 'all',
    totalRaces: ordered.reduce((a, r) => a + r.totalRaces, 0),
    wins: ordered.reduce((a, r) => a + r.wins, 0),
    podiums: ordered.reduce((a, r) => a + r.podiums, 0),
  };
  return [...ordered, totals];
}
```

Notes:

- Three constant rows per call (one per race_kind) + the totals row,
  even when a driver has zero races in a kind. Operators expect to
  see zeros, not gaps. The Q-H7-9 ordering is enforced by the
  hard-coded array.
- Totals row is computed in JS rather than a UNION ALL because the
  per-kind result is already in memory; a SQL UNION would double the
  query cost for marginal benefit.
- `placement <= 3` for podiums is inclusive of wins (a win is also a
  podium). The display copy ("wins / podiums") matches this convention.
- For races with `placement = NULL` (theoretical — H4's hard-delete
  doesn't NULL placements), `SUM(CASE WHEN NULL <= 3 ...)` returns
  NULL → 0 under SQLite's three-valued logic. Defensive but not
  load-bearing.

### Driver profile page wiring

Below the existing "Linked to" / admin-link block in
`app/racing/drivers/[driverId]/page.tsx`:

```tsx
const winLoss = driverWinLossStats(handle, driver.id);

// ...
<section className="mt-6">
  <h2 className="text-lg font-medium">Career stats</h2>
  <table className="mt-2 w-full border-separate border-spacing-y-1 text-xs">
    <thead>
      <tr className="text-slate-500">
        <th className="text-left font-normal">Kind</th>
        <th className="text-right font-normal">Races</th>
        <th className="text-right font-normal">Wins</th>
        <th className="text-right font-normal">Podiums</th>
      </tr>
    </thead>
    <tbody>
      {winLoss.map((row) => (
        <tr
          key={row.raceKind}
          className="rounded-md border border-slate-800 bg-slate-900"
        >
          <td className="rounded-l-md border-y border-l border-slate-800 bg-slate-900 px-2 py-1 text-slate-400">
            {row.raceKind}
          </td>
          <td className="border-y border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono tabular-nums">
            {row.totalRaces}
          </td>
          <td className="border-y border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono tabular-nums">
            {row.wins}
          </td>
          <td className="rounded-r-md border-y border-r border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono tabular-nums">
            {row.podiums}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

Reviewer (CQ5 / MAJOR #2) pushed the `<dl>` + `grid-cols-4` shape to
`<table>`. With 5 children (1 header div + 4 data rows) in a 4-column
grid, the `all` totals row wrapped to row 2 column 1 — visually broken.
`<table>` with `<thead>/<tbody>` handles 4 data rows correctly by
design and is semantically appropriate for tabular data.

---

## Phase F — Symbol updates

`symbols/manifest.json`:

```json
"app": {
  "properties": {
    "...": "...",
    "game_categories_count": 8
  }
}
```

Then `python3 scripts/align.py lock`. Commit `manifest.json` and
`manifest.lock` together.

---

## Three must-work flows

### Flow 1 — Per-category profile rollup

Player has 6 ratings rows: 3 racing games (RR1: 1300/10g, RR2:
1500/4g, RR3: 1100/2g), 2 yard games (Cornhole: 1400/5g, KanJam:
1200/0g), 1 bar game (Pool: 1350/8g). Profile renders:

```
By category
  Racing       1325 · 3 games · 16 matches
  Bar          1350 · 1 games · 8 matches
  Yard         1400 · 1 games · 5 matches
```

(KanJam excluded from yard because `games_played = 0`. Racing
weighted: `(1300*10 + 1500*4 + 1100*2) / 16 = 21200/16 = 1325`.
ORDER BY rating DESC.)

Games section renders:
```
Bar
  Pool         1350 · 8g
Racing
  RR1          1300 · 10g
  RR2          1500 · 4g
  RR3          1100 · 2g
Yard
  Cornhole     1400 · 5g
  KanJam       1200 · 0g  ← shown in Games (not in rollup)
```

### Flow 2 — Admin recategorizes an existing game

Operator opens `/games` post-deploy. All 12 games show `Other` in the
new category dropdown column. Operator clicks the dropdown on "Forza"
→ picks `Racing` → Save button appears → tap. Client PATCHes
`/api/games/<gameId>` with `{category: 'racing'}`. Server validates,
UPDATE games SET category. `router.refresh()` re-renders, dropdown
now shows `Racing` selected, Save button hidden. Players whose
profile loads see Forza grouped under Racing immediately on next
navigation.

### Flow 3 — RC driver career stats

Driver has raced 12 races, 8 qualifs, 3 practices. Wins: 4 race, 2
qualif, 0 practice. Podiums: 7 race, 5 qualif, 1 practice. Profile
renders the Career stats block:

```
Kind    | Races | Wins | Podiums
race    | 12    | 4    | 7
qualif  | 8     | 2    | 5
practice| 3     | 0    | 1
all     | 23    | 6    | 13
```

---

## Test plan

Vitest, ephemeral SQLite per test file. Target ~16–20 new tests.

### Unit

`tests/unit/categories.test.ts` (new, +4):

1. `isKnownCategory('racing')` returns true.
2. `isKnownCategory('mmo')` returns false.
3. `categoryLabel('yard')` returns `'Yard'`.
4. `categoryLabel('mystery-slug')` returns the raw slug `'mystery-slug'`.

`tests/unit/queries.test.ts` (edit, +5):

5. `playerCategoryRatings`: 2 racing games (1300×10g + 1500×4g) →
   one row with rating = `CAST(ROUND(19000/14) AS INTEGER) = 1357`.
   (Reviewer-corrected — original draft pasted Flow 1's `21200` numerator
   from the three-game fixture into this two-game one. Correct: `1300×10
   + 1500×4 = 19000`, `19000/14 ≈ 1357.14`, ROUND → 1357.)
6. `playerCategoryRatings`: zero-match game excluded — rating row
   with `games_played = 0` does not appear in any category rollup.
7. `playerCategoryRatings`: rounding ties — fixture
   `current_rating = 1350.5, games_played = 1`. SQLite `ROUND(1350.5)`
   is banker's even → `1350` (not `1351`). Test name documents the
   rounding mode explicitly.
8. `playerCategoryRatings`: ORDER BY rating DESC — three categories
   with ratings 1100, 1400, 1300 → returned in 1400, 1300, 1100
   order.
9. `playerGameRatings`: returns rows ordered by category, then
   game name; zero-match games included.

`tests/unit/rc-driver-winloss.test.ts` (new, +4):

10. `driverWinLossStats` returns 4 rows in order `race`, `qualif`,
    `practice`, `all`.
11. Driver with 3 race-kind races (1st, 2nd, 5th): race row has
    totalRaces=3, wins=1, podiums=2.
12. Driver with no races: all 4 rows have zeros.
13. Totals row aggregates correctly: `all.totalRaces ===
    race.totalRaces + qualif.totalRaces + practice.totalRaces`,
    same for wins + podiums.

`tests/unit/migrate.test.ts` (edit, +1):

14. 0008 idempotency: running migrate twice keeps a single
    `category` column on `games`, NOT NULL, DEFAULT `'other'`.
    Existing rows have `category = 'other'`.

### Integration

`tests/integration/games-api.test.ts` (new, +5):

15. POST `/api/games` with `{category: 'racing', ...}` → 201,
    row inserted with `category = 'racing'`.
16. POST `/api/games` without `category` → 201, row has
    `category = 'other'`.
17. POST `/api/games` with `{category: 'mystery'}` → 400.
18. PATCH `/api/games/<id>` admin-gated: 401 when no session,
    403 when user role, 404 when bogus id, 200 + UPDATE on valid.
19. PATCH `/api/games/<id>` with `{category: 'mystery'}` → 400.

`tests/integration/rc-queries.test.ts` (edit, +1):

20. `driverWinLossStats` against a fixture with a 1st-place finish
    in every qualif: qualif.wins === total qualifs; race row has
    zero races (no race-kind seeded).

### Test count

4 + 5 + 4 + 1 + 5 + 1 = **20 new test cases**. Comfortable inside
the 16–20 floor/ceiling.

---

## Quality bar

- No comments unless WHY is non-obvious. Pinned comment worth
  keeping: the `WHERE r.games_played > 0` filter in
  `playerCategoryRatings` (defensive against 1200-starter pollution),
  the totals-row JS rather than SQL UNION rationale.
- No mocks at the DB boundary. Ephemeral SQLite per test file.
- TypeScript strict; no `any` without a `// reason:` line. The
  zod `z.enum(GAME_CATEGORY_SLUGS as [...])` cast is a known TS
  ceremony for enum-from-readonly-tuple; no `any` needed.
- ESLint + Prettier + typecheck + build clean.
- Mobile-first: category dropdown on `/games` keeps `h-tap`.
  Profile category rows render the same shape as today's per-game
  rows (44px target preserved). RC career stats grid uses
  `grid-cols-4` on mobile already — the existing per-track best
  list at 414px renders 2 columns of icon+text, so 4 columns of
  numbers fits comfortably.

---

## Verification

After implementation:

1. `python3 scripts/align.py check` exits 0. Symbol change (Q-H7-13)
   requires `align.py lock` first.
2. `cd wizard && python3 -m pytest -q` — still 104 passing. H7 makes
   zero wizard edits.
3. `cd eloup-web && pnpm test && pnpm lint && pnpm typecheck && pnpm build` clean.
4. `docker build` succeeds (the Dockerfile copies `lib/games/` along
   with the rest of `lib/`; no Dockerfile edit needed unless the
   COPY pattern misses the new dir — verify).
5. **Do NOT run the wizard. Do NOT push to remote. Do NOT call any
   prod API.**

---

## Out of scope for H7 (do NOT build)

- **MongoDB or any storage-engine change.** Strong operator decision.
- **Operator-managed dynamic category table** (`game_categories`
  table with CRUD). Categories live in code for now; admin adds via
  1-line edit. Defer to a future task only if the in-code list
  becomes painful.
- **Cross-category overall ELO** (a roll-up across multiple
  categories that's something other than `players.overall_rating`).
  Overall ELO stays as-is.
- **Per-track win/loss breakdown** on RC driver profile. Phase E is
  per-race-kind only.
- **Game-level match win-rate stats** on the multi-game profile.
  Per-category ELO + per-game ratings only. Wins-per-game requires
  `matches` aggregation by placement, a separate query — defer.
- **Wizard changes.**
- **Editing format / min / max / K from a per-row affordance on
  `/games`.** PATCH is `{ category }` only. Editing other fields
  remains "delete + re-create" until an operator asks for inline
  editing of those fields.
- **`/games` row-level "category badge".** The dropdown's currently
  selected value is its own indicator; a separate badge would be
  redundant.

---

## Commit shape

Five commits expected:

1. `docs: H7 — profile expansions task doc` — this file only.
   **STOP after this commit and request review.**
2. `docs: H7 — reviewer report` — landed by a different agent in
   `Agents/Review-reports/h7-profile-expansions-review.md` referencing
   this filename.
3. `docs: H7 — fold reviewer findings, flip task to In Progress` —
   ONLY if review flags MAJOR-grade changes that require a doc
   update before implementation. Otherwise skip and absorb the
   reviewer's notes inline in commit 4.
4. `feat: eloup-web — H7 profile expansions (categories + RC win/loss)`
   — Phases A–E + F (symbol) + tests. Implementer MAY split into
   two feature commits at their discretion (A+B+C in one, D+E+F
   in another) if the diff balloons.
5. `docs: H7 — mark task Complete` — flip Status, verification
   results in the commit body.

Each commit ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Hand-offs

After H7 ships:

- **Per-track RC win/loss** is the natural follow-up if the operator
  wants the per-track breakdown deferred from Phase E.
- **Game-level match win-rate** for the multi-game profile (per-game
  wins, not just ratings) — similar shape, different aggregation
  against `match_participants.placement`.
- **Operator-managed dynamic category table** (`game_categories`
  table with CRUD) — only if the in-code list becomes painful.
- **Cross-category compare** (Racing vs Yard on a single profile
  surface) — bigger UX work; defer until requested.
- **Category icons.** Title-Cased labels are fine for MVP; if the
  operator wants visual differentiation at a party, add a small
  glyph per category in `lib/games/categories.ts`.

---

## Clarifying questions surfaced while writing this doc

Flagging for the reviewer:

1. **POST `/api/games` default vs. required category** (Q-H7-10).
   I picked "optional with DEFAULT 'other'" — keeps existing curl
   clients working, matches the schema default. The form sends an
   explicit value either way. Reviewer can push toward "required
   in the API body" if symmetry with the form matters more than
   curl compatibility.

2. **`zod.enum` vs. `zod.string().refine(isKnownCategory)`.** The
   spec mentions both. `z.enum` is more explicit at the TS level
   but requires the slug-tuple cast; `z.string().refine` is
   easier to read but loses the literal-union inference on
   `parsed.data.category`. I lean `z.enum` for type fidelity;
   reviewer's call if the cast ceremony pushes them toward
   `.refine`.

3. **`playerCategoryRatings` ORDER BY rating DESC vs. category
   alphabetical.** The spec says "Sorted by weighted-average ELO
   descending" — I'm following that. If a future operator wants
   alphabetical for predictability ("Bar always first"), it's a
   one-line ORDER BY swap. Flagging since both are defensible.

4. **`playerGameRatings` includes zero-match games**, but
   `playerCategoryRatings` excludes them. Asymmetric on purpose
   (Q-H7-6) — the rollup formula divides by `SUM(games_played)`
   which would be zero for a category with only zero-match games.
   Worth a code comment in the implementation; flagging for the
   reviewer in case they want symmetry instead (both exclude /
   both include — at which point the rollup query needs guards).

5. **RC career stats `<dl>` vs. `<table>`.** Phase E spec allows
   either. The driver profile already uses `<ul>` lists for best
   laps and recent races; a `<table>` would be the first table on
   the page. I lean `<dl>` for consistency with the H5 stat-grid
   aesthetic; reviewer can push to `<table>` if grid columns
   don't render cleanly on 320px iPhone SE.

6. **Symbol property name** (Q-H7-13). `game_categories_count: 8`
   is one option; `game_categories: 8` is shorter but less
   descriptive; `game_category_count: 8` (singular) is also
   defensible. I lean `game_categories_count` for symmetry with
   how other count-fields would read (none exist yet, so I'm
   setting the convention). Reviewer's call.

7. **0008 migration on the existing games rows.** The DEFAULT
   `'other'` populates new rows; SQLite's `ALTER TABLE ADD COLUMN
   ... DEFAULT 'other'` also backfills existing rows to `'other'`
   (this is the standard SQLite behavior — confirmed by 0005 and
   0006 patterns). No separate data-fixup migration needed.
   Flagging in case the reviewer wants an explicit
   `UPDATE games SET category = 'other' WHERE category IS NULL` as
   a defensive belt-and-suspenders (it would be a no-op given the
   NOT NULL DEFAULT, but harmless).
