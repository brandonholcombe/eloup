# UX0 — Design foundation: shadcn scaffold + tokenized dark theme

## Author: claude-opus-4.8-ux0-implementer
## Status: Complete

## Implementation outcome (2026-07-19)

Phase 0 implemented; all reviewer BLOCKING/SHOULD-FIX items honored; pixel-stable.

- **Deps:** `@radix-ui/react-slot`, `lucide-react`, `class-variance-authority`,
  `tailwind-merge`, `clsx`, `tailwindcss-animate` added. S5 friction did NOT
  materialize — `@radix-ui/react-slot@1.3.0` supports React 19; the only peer
  warning is the pre-existing next/react-rc one. No `pnpm.overrides` needed.
- **Scaffold:** `components.json` (new-york), `lib/utils.ts` (`cn`),
  `components/ui/button.tsx` (canonical shadcn Button — plain forwardRef, no
  `'use client'`, OPTIONAL-1).
- **Tokens (`globals.css`):** dark-only HSL vars on `:root`; `--primary` =
  blue-500 `217 91% 60%` (BLOCKING-2), `--muted-foreground` = slate-500 (S3),
  `--radius` = 0.375rem. **No `color-scheme: dark`** (SHOULD-FIX-1) — verified 0
  occurrences in built CSS, so native controls are unchanged. Did NOT add the
  shadcn `* border-border` / `body bg-background` base rules (would have shifted
  literal-class elements); vars are purely additive.
- **`tailwind.config.ts`:** `darkMode: ["class"]` (O3), CSS-var colors,
  `borderRadius` off `--radius`, `tailwindcss-animate` plugin; H8
  `height/minHeight/minWidth.tap` + safe-area spacing preserved (verified
  `.h-tap{height:44px}` still emitted).
- **Migration (BLOCKING-2, SHOULD-FIX-2):** `NewGameForm` submit →
  `<Button>` default (`className="h-tap w-full shadow-none"` — pins 44px +
  full-width, neutralizes the added shadow; `bg-primary` = blue-500 so no color
  shift). `BottomNav` sign-in → `<Button variant="ghost">` with
  `hover:bg-transparent` to stay backgroundless like before.
- **Symbol/docs (S1/S2/SHOULD-FIX-3):** `app.ui_lib` → `tailwind_shadcn`;
  `app.description` prose rewritten; `docs/app.md:14` both cells updated + Q-APP-3
  recorded resolved→shadcn; `align.py lock` regenerated (root `a2ef7d6b…`,
  aligned). **S2 manual read done** — description no longer says
  "hand-written / no shadcn" (the check can't see it).

**Gates:** `pnpm lint` clean · `pnpm typecheck` exit 0 · `pnpm test` **308
passing** (unchanged) · `pnpm build` clean · `align.py check` OK. First-load JS:
`/games` 102→**112KB** (~10KB from cva/tailwind-merge/slot/Button on the one
client route, as predicted OPTIONAL-2), **shared 100KB unchanged**, leaderboards
109KB unchanged — all under the 150KB ceiling. App is visually identical.

**Next:** Phase 1 (`ux1-primitives.md`) — adopt the rest of the shadcn primitives,
emoji→Lucide, and sweep the 21 duplicated card strings.

## Reviewer findings folded (2026-07-19)

Independent review at `Agents/Review-reports/ux0-design-foundation-review.md`
(Reviewer: `claude-opus-4.8-ux0-reviewer`) returned **Request-changes** — 2
blocking, 3 should-fix, 2 optional. Scaffold shape, HSL math, symbol/doc targets,
S2, lock regen, and test-safety were all verified correct. The corrections are
folded into the steps below:
- **BLOCKING-1:** the new-york Button imports `@radix-ui/react-slot`, which was
  missing from the install list → build would fail. Added to Step 1.
- **BLOCKING-2:** the two migrated buttons have **different** looks and the
  proposed indigo `--primary` would change NewGameForm's submit blue→indigo,
  breaking pixel-stability. `--primary` is now **blue-500 `217 91% 60%`**;
  sign-in maps to the **`ghost`** variant, submit to **`default`** — variant per
  button stated explicitly in Step 4.
- **SHOULD-FIX-1:** `color-scheme: dark` visibly changes native `<select>`/number
  inputs + scrollbars → **deferred out of Phase 0** (to Phase 2/5 with intended
  form-control styling) to keep Phase 0 pixel-stable.
- **SHOULD-FIX-2:** shadcn `default` size is `h-10` (40px), regressing H8's 44px
  → Step 4 pins the migrated submit to `h-tap w-full` explicitly.
- **SHOULD-FIX-3:** `docs/app.md:14` is stale in **two** cells (the Pick label
  AND the Why prose) — both updated in Step 5.
- **OPTIONAL-1/2:** Button stays a plain (no `'use client'`) forwardRef; the
  ~10KB bundle delta lands on the `/games` first-load — both noted.

## Parent

Phase 0 of `ux-overhaul-plan.md` (umbrella, reviewed
Approve-with-changes). This doc is the concrete, implementable unit; the five
reviewer should-fix items (S1–S5) from
`Agents/Review-reports/ux-overhaul-plan-review.md` are baked into the steps
below. Decisions locked this session: **systematize + polish**, **shadcn/ui**,
**Lucide icons**, **dark-only**, projection deferred.

## Goal & non-goals

**Goal:** stand up the shadcn scaffold + a tokenized dark-slate theme, with the
app **visually unchanged** (pixel-stable). Migrate exactly ONE primitive
(`Button`) end-to-end as proof of the pipeline. Update the `app` symbol + lock to
record the shadcn adoption.

**Non-goals (belong to later phases):** no screen redesign, no emoji→Lucide swap
(Phase 1), no mass component migration (Phase 1), no contrast bump (Phase 2), no
motion (Phase 4). Purely foundation.

**Success = the app looks identical** except the single migrated Button, and the
token layer is in place for Phase 1 to build on.

## Preconditions (verify first)

- `eloup-web/package.json`: `tailwindcss@3.4.14` (v3 — use the v3 shadcn flow,
  NOT v4), `react@19.0.0`, `pnpm@10.20.0`, Next 15 App Router, RSC.
- Confirm `app/globals.css` currently only has the `@tailwind` directives +
  `--safe-*` vars + tap-highlight reset (H8 state).

## Scope / steps

### 1. shadcn scaffold (manual, Tailwind v3 flow)
- Add `components.json` at `eloup-web/`: `{ "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york", "rsc": true, "tsx": true, "tailwind": { "config":
  "tailwind.config.ts", "css": "app/globals.css", "baseColor": "slate",
  "cssVariables": true }, "aliases": { "components": "@/components", "utils":
  "@/lib/utils", "ui": "@/components/ui" } }`. (**S-review O2:** use `new-york`,
  not the deprecated `default`.)
- Create `eloup-web/lib/utils.ts`:
  ```ts
  import { clsx, type ClassValue } from 'clsx';
  import { twMerge } from 'tailwind-merge';
  export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
  }
  ```
- Add deps: `@radix-ui/react-slot` (**BLOCKING-1** — the new-york Button imports
  `Slot` for `asChild`; without it `pnpm build` fails), `lucide-react`,
  `class-variance-authority`, `tailwind-merge`, `clsx`, `tailwindcss-animate`.
  (Lucide isn't used until Phase 1 but installing it now keeps the scaffold in
  one commit; do not import it yet.) The S5 React-19 peer override, if any,
  applies to `@radix-ui/react-slot`.
- **⚠️ S5 — install friction:** React 19 under pnpm 10 (strict peers). If
  `pnpm install` warns/fails on a Radix `react: ^18` peer (via
  `@radix-ui/react-slot` pulled by Button), pin React-19-compatible versions and
  add a `pnpm.overrides` (or `pnpm.peerDependencyRules.allowedVersions`) entry in
  `package.json`. Record whatever was needed in the outcome note. Do not assume a
  frictionless install.

### 2. Token theme — dark-only (`app/globals.css`)
Define shadcn's HSL CSS vars on `:root`, mapped to the CURRENT slate palette so
nothing shifts. Set `color-scheme: dark`. Proposed mapping (implementer: verify
each hex→HSL against Tailwind's actual `slate` values; space-separated HSL, no
`hsl()` wrapper, per shadcn):

| var | source | approx HSL |
|---|---|---|
| `--background` | slate-950 `#020617` | `229 84% 5%` |
| `--card` / `--popover` | slate-900 `#0f172a` | `222 47% 11%` |
| `--foreground` / `--card-foreground` | slate-100 `#f1f5f9` | `210 40% 96%` |
| `--muted` | slate-800 `#1e293b` | `217 33% 17%` |
| `--muted-foreground` | **slate-500** `#64748b` | `215 16% 47%` |
| `--border` / `--input` | slate-800 `#1e293b` | `217 33% 17%` |
| `--secondary` / `--accent` | slate-800 | `217 33% 17%` |
| `--primary` | **blue-500 `#3b82f6`** (matches NewGameForm's current `bg-blue-500` — BLOCKING-2; do NOT use indigo, it would shift the submit blue→indigo) | `217 91% 60%` |
| `--primary-foreground` | near-white | `210 40% 98%` |
| `--destructive` | red-ish | `0 62% 45%` |
| `--ring` | matches `--primary` or slate-400 | — |
| `--radius` | current rounded-md ≈ `0.375rem` | — |

- **⚠️ S3 — `--muted-foreground` = slate-500 (NOT slate-400) in Phase 0.**
  Nothing consumes `text-muted-foreground` yet (50 literal `text-slate-500`
  usages), so setting it to slate-500 keeps Phase 0 pixel-stable. The slate-500→400
  contrast bump lands in the **Phase 2** class sweep where components switch to
  the token.
- Dark-only: apply the vars directly on `:root` (no `.dark`-class toggle needed
  for rendering); shadcn components read the semantic classes regardless.
- **⚠️ SHOULD-FIX-1 — do NOT set `color-scheme: dark` in Phase 0.** The layout
  sets no `color-scheme` today, so native `<select>`/`<input type=number>`
  dropdowns, spinners, and scrollbars render light; adding it would visibly flip
  them (esp. on `/games` NewGameForm) — a real change that breaks pixel-stability.
  Defer `color-scheme: dark` to a later phase (2/5) alongside intended
  form-control styling.

### 3. `tailwind.config.ts`
- Add `darkMode: ["class"]` (**O3** — enables a future light theme as a flip, not
  a selector migration; also add a `.dark`-class convention note).
- Extend `theme.colors` (or `extend.colors`) to reference the CSS vars per the
  shadcn v3 pattern: `background: 'hsl(var(--background))'`, `foreground`,
  `card: { DEFAULT, foreground }`, `popover`, `primary: { DEFAULT, foreground }`,
  `secondary`, `muted: { DEFAULT, foreground }`, `accent`, `destructive`,
  `border`, `input`, `ring`.
- `borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm:
  'calc(var(--radius) - 4px)' }`.
- Add the `tailwindcss-animate` plugin to `plugins`.
- **Preserve** the existing H8 extends: `height/minHeight/minWidth.tap: 44px`
  and the `safe-bottom`/`safe-top` spacing. Do not remove them.
- Do NOT restyle existing text: only add a type scale if it leaves current
  rendering unchanged (safer to skip in Phase 0).

### 4. Proof migration — ONE Button (variant per button, BLOCKING-2)
- Generate the shadcn `Button` into `components/ui/button.tsx` (CVA variants:
  default/secondary/outline/ghost/destructive; sizes: default/sm/lg/icon). With
  `--primary` = blue-500, the `default` variant (`bg-primary`) reproduces
  NewGameForm's current `bg-blue-500` fill.
- **⚠️ OPTIONAL-1 — keep `button.tsx` a plain (no `'use client'`) forwardRef
  component** (the canonical shadcn Button is exactly that). BottomNav is a
  server component; adding `'use client'` to the Button would be unnecessary and
  risks the server-action boundary. No ref/handler is passed here.
- Replace exactly two buttons, each mapped to the **correct variant** so the look
  is unchanged:
  - `components/NewGameForm.tsx` submit (currently solid `bg-blue-500 text-white
    h-tap w-full`) → `<Button>` **`default`** variant, **pinned to `h-tap w-full`
    via `className`** (SHOULD-FIX-2 — shadcn `default` size is `h-10`/40px, which
    would regress the H8 44px target and drop full-width).
  - `components/BottomNav.tsx` sign-in (currently backgroundless `flex-col
    text-xs text-slate-300 hover:text-white`) → `<Button variant="ghost">` plus
    its existing `flex-col text-xs text-slate-300 hover:text-white h-tap
    min-w-tap w-full` via `className`. The form still uses its inline
    `'use server'` action; the Button is just the trigger.
- Do NOT migrate any other buttons (Phase 1).

### 5. Symbol + docs + lock (one commit)
- `symbols/manifest.json`: set `app.properties.ui_lib` →
  `tailwind_shadcn`.
- **⚠️ S1 + SHOULD-FIX-3 — edit THREE stale strings:** (a) the `app.description`
  prose in `symbols/manifest.json` (currently "Tailwind + hand-written components
  (no shadcn-CLI dependency)"); and on `docs/app.md:14` BOTH (b) the Pick-column
  label cell "Tailwind + hand-written components" AND (c) the Why prose
  "Originally planned shadcn/ui; settled on hand-written Tailwind…". All three
  must now reflect shadcn/ui adoption, or the docs are internally contradictory
  after the flip. Record Q-APP-3 resolved (→ shadcn/ui) in `docs/app.md`.
- Run `python scripts/align.py lock`; commit `manifest.json` + `manifest.lock` +
  `docs/app.md` + all code together.
- **⚠️ S2 — `align.py` does NOT hash symbol descriptions.** `align.py check`
  will report green even if the `app.description` prose is left stale and
  contradicts `ui_lib`. Manually read `app.description` after editing to confirm
  it no longer says "hand-written / no shadcn." This is an un-verified step —
  don't rely on the tool.

## Testing / verification

- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` all green (existing
  suite is test-safe per the plan review: e2e asserts heading text/health/
  manifest/sw; unit tests assert text/structure, not button markup or slate
  classes).
- `pnpm build`: first-load JS must stay within budget — H8 baseline 100–114KB,
  ≤150KB ceiling. Report the delta from adding CVA/tailwind-merge/react-slot +
  the Button. **(OPTIONAL-2):** the delta (~10KB) lands on the `/games`
  (NewGameForm, a client component) first-load, not universally — call it out
  specifically, not just app-wide.
- `python scripts/align.py check` → OK, **plus a manual read of
  `app.description`** (S2 — the check can't see it).
- Manual 390px smoke: the app is visually identical (color-scheme deferred, so
  native form controls are unchanged too); the sign-in and New Game buttons look
  and work exactly as before (blue solid submit, backgroundless ghost sign-in);
  no regression in the bottom nav / safe-area padding / 44px targets.

## Review gate

Edits `eloup-web/` + `symbols/`, so per CLAUDE.md this needs an independent
review report in `Agents/Review-reports/` by a **different** agent than
`## Author:` above, referencing `ux0-design-foundation.md`, before implementation.
Flip to `## Status: In Progress` when starting, `## Status: Complete` when done.
