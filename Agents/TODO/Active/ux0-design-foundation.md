# UX0 — Design foundation: shadcn scaffold + tokenized dark theme

## Author: claude-opus-4.8-ux0-implementer
## Status: Not Started

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
- Add deps: `lucide-react`, `class-variance-authority`, `tailwind-merge`,
  `clsx`, `tailwindcss-animate`. (Lucide isn't used until Phase 1 but installing
  it now keeps the scaffold in one commit; do not import it yet.)
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
| `--primary` | implementer's accent (default indigo-ish, consistent with `themeColor #0f172a`) | e.g. `239 84% 67%` |
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

### 4. Proof migration — ONE Button
- Generate the shadcn `Button` into `components/ui/button.tsx` (CVA variants:
  default/secondary/outline/ghost/destructive; sizes: default/sm/lg/icon). Theme
  the `default` variant to match the app's current button look (so no visible
  change), and ensure it satisfies the H8 44px tap-target minimum.
- Replace buttons on ONE small surface to exercise the pipeline: the sign-in
  button in `components/BottomNav.tsx` **and** the submit in
  `components/NewGameForm.tsx`. Keep labels/behavior identical; the sign-in form
  still uses its inline `'use server'` action (the Button is just the trigger).
- Do NOT migrate any other buttons (Phase 1).

### 5. Symbol + docs + lock (one commit)
- `symbols/manifest.json`: set `app.properties.ui_lib` →
  `tailwind_shadcn`.
- **⚠️ S1 — edit BOTH stale strings:** (a) the `app.description` prose in
  `symbols/manifest.json` (currently "Tailwind + hand-written components (no
  shadcn-CLI dependency)") and (b) the different wording in `docs/app.md:14`
  ("Originally planned shadcn/ui; settled on hand-written Tailwind…"). Both must
  now reflect shadcn/ui adoption. Record Q-APP-3 resolved (→ shadcn/ui) in
  `docs/app.md`.
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
  ≤150KB ceiling. Report the delta from adding CVA/tailwind-merge + the Button.
- `python scripts/align.py check` → OK, **plus a manual read of
  `app.description`** (S2 — the check can't see it).
- Manual 390px smoke: the app is visually identical except the one migrated
  Button; the sign-in and New Game buttons still work; no regression in the
  bottom nav / safe-area padding.

## Review gate

Edits `eloup-web/` + `symbols/`, so per CLAUDE.md this needs an independent
review report in `Agents/Review-reports/` by a **different** agent than
`## Author:` above, referencing `ux0-design-foundation.md`, before implementation.
Flip to `## Status: In Progress` when starting, `## Status: Complete` when done.
