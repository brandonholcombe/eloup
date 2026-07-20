# Review — UX0 Design foundation (shadcn scaffold + tokenized dark theme)

## Reviewer: claude-opus-4.8-ux0-reviewer

Task under review: `ux0-design-foundation.md` (Author:
`claude-opus-4.8-ux0-implementer`), Phase 0 of `ux-overhaul-plan.md`.

## Verdict: Request-changes

The scaffold shape, HSL token math, symbol/doc edit targets, and test-safety
claims are all accurate — I verified each against the real tree. But two items
will break the task's own success criterion or the build if implemented **as
written**, so they must be resolved in the doc before implementation:

1. A missing runtime dependency (`@radix-ui/react-slot`) that the new-york
   Button imports — omitted from the install list, so the build fails.
2. A self-contradiction between the "pixel-stable" goal and the migration of
   `NewGameForm`'s **blue** submit button under a proposed **indigo**
   `--primary`, plus two different button looks collapsed into one `default`
   variant.

Both are small, in-scope clarifications. Everything else is sound.

---

## What I verified as CORRECT (do not re-litigate)

- **Preconditions accurate.** `eloup-web/package.json` is `tailwindcss@3.4.14`,
  `react@19.0.0`, `pnpm@10.20.0`, `next@15.0.3` (App Router). `app/globals.css`
  is exactly the H8 state the doc describes (only `@tailwind` directives +
  `--safe-*` vars + tap-highlight reset). `tailwind.config.ts` has precisely the
  `height/minHeight/minWidth.tap: 44px` + `safe-bottom/safe-top` spacing extends
  the doc promises to preserve.
- **components.json aliases match tsconfig.** `tsconfig.json:19-21` maps
  `@/* → ./*`, so `@/components`, `@/lib/utils`, `@/components/ui` all resolve.
  `style: "new-york"`, `rsc: true`, `baseColor: "slate"`, `cssVariables: true`
  are the correct v3 shape. Good.
- **HSL mapping is accurate and non-regressive.** I recomputed every spot-check:
  slate-950 `#020617` → `229 84% 5%` ✓, slate-900 `#0f172a` → `222 47% 11%` ✓,
  slate-500 `#64748b` → `215 16% 47%` ✓, slate-100 `#f1f5f9` → `210 40% 96%` ✓,
  slate-800 `#1e293b` → `217 33% 17%` ✓. All match the table. The S3 call
  (`--muted-foreground` = slate-500 not slate-400 in Phase 0) is correct and
  necessary for pixel-stability.
- **`darkMode:["class"]` + vars on `:root` is NOT a contradiction.** The
  `darkMode` setting only gates the `dark:` *variant*; the semantic utilities
  (`bg-background`, etc.) are plain classes that read `hsl(var(--x))`
  unconditionally, so with the vars on `:root` they render the dark palette
  regardless of any `.dark` class. There are zero `dark:`-prefixed utilities in
  the tree today, so adding `darkMode:["class"]` is harmless future-proofing
  (O3). Dark renders correctly.
- **S1 targets exist verbatim.** `symbols/manifest.json:132` app.description says
  `"Tailwind + hand-written components (no shadcn-CLI dependency)"`;
  `app.properties.ui_lib` is `"tailwind_handwritten"` (line 137);
  `docs/app.md:14` says `"Originally planned shadcn/ui; settled on hand-written
  Tailwind components…"`. All as quoted.
- **S2 is correct.** `scripts/align.py` `build_lock()` (lines 177-236) hashes
  only `properties` (`hash_properties`, line 209) and doc *files* (`hash_file`,
  line 202); `build_means` (line 169) also uses only properties. Descriptions
  are never hashed — `align.py check` will stay green with a stale
  `app.description`. The manual-read caveat is warranted.
- **Lock regen is single-command (Q5).** Flipping `ui_lib` changes app's
  prop-hash; editing `docs/app.md` (a hashed doc, `manifest.json:133`) changes
  its file-hash. Both feed app's leaf → root, so one `python scripts/align.py
  lock` regenerates cleanly. `means` for app will then read `…ui_lib=
  tailwind_shadcn…`. No interlock touches `app` (deployment's interlocks are on
  `architecture`), so nothing else moves. No gotcha.
- **Test-safety claim holds.** No test imports `globals.css`; the only `<button`
  reference in tests is a comment in `tests/unit/compare-drivers-section.test.ts:81`
  (about the driver-compare chip, unrelated). No test imports `BottomNav` or
  `NewGameForm` or asserts button markup / slate classes. `e2e/golden-path.spec.ts`
  asserts only the Leaderboards heading, `/api/health`, the manifest, and the
  SW body string. Migrating those two buttons cannot break the suite.
- **Body is not tokenized.** `app/layout.tsx:26` uses literal `bg-slate-950
  text-slate-100`; the semantic vars are consumed by nobody in Phase 0 (only the
  one Button). So defining vars alone shifts nothing — the pixel-stability
  reasoning is valid, and the CSS-var migration does not touch the ~50 literal
  `text-slate-*` / `bg-slate-*` usages (they are separate literals). Correct.

---

## Findings

### BLOCKING-1 — `@radix-ui/react-slot` is missing from the install list
`components/ui/button.tsx` in the **new-york** style imports
`@radix-ui/react-slot` (`Slot`, for `asChild`). This is a manual scaffold (no
shadcn CLI to auto-add deps), and `node_modules/@radix-ui/react-slot` is not
present. Step 1's dep list is `lucide-react, class-variance-authority,
tailwind-merge, clsx, tailwindcss-animate` — Slot is only *mentioned* in the S5
peer-friction note, never listed as a package to add. As written, the Button
won't compile / `pnpm build` fails. **Fix:** add `@radix-ui/react-slot`
explicitly to the Step-1 install list (this is also the package the S5 React-19
peer override, if any, applies to).

### BLOCKING-2 — the "pixel-stable" goal contradicts the proposed Button migration
The doc migrates **two** buttons with **different** looks under **one** `default`
variant, and proposes an `--primary` that doesn't match either:

- `components/BottomNav.tsx:24-31` sign-in: **no background**, flex-col, `text-xs`,
  `text-slate-300 hover:text-white` — this is a **ghost/text** button.
- `components/NewGameForm.tsx:122-128` submit: **solid** `bg-blue-500 text-white`
  `h-tap w-full`. blue-500 `#3b82f6` ≈ HSL `217 91% 60%`.

The token table (line 78) proposes `--primary` = indigo `239 84% 67%` (`#6366f1`).
If `NewGameForm`'s submit is swapped to a `default`-variant `<Button>`
(`bg-primary`), its color changes **blue → indigo** — a plainly visible shift on
`/games`, which violates the doc's single success criterion ("the app looks
identical except the single migrated Button"). And a `default` variant themed to
look solid cannot simultaneously reproduce the backgroundless sign-in button.

**Fix (specify in the doc):**
- Set `--primary` to blue-500's HSL (`217 91% 60%`) so `NewGameForm`'s submit is
  pixel-stable, **or** keep the submit's literal `bg-blue-500` via `className`
  and don't rely on the variant for its fill.
- Render the BottomNav sign-in as the **`ghost`** variant (or `variant="ghost"`
  + the existing `text-slate-300 hover:text-white flex-col text-xs` classes via
  `className`), not `default`.
- State the exact variant each of the two buttons maps to. As written the mapping
  is ambiguous and the indigo `--primary` guarantees a regression.

### SHOULD-FIX-1 — `color-scheme: dark` is itself a visible change
`NewGameForm` has native `<select>` (lines 69-89) and `<input type="number">`
(lines 93-119). `app/layout.tsx` sets no `color-scheme` today, so their dropdown
list, option menu, number spinners, and scrollbars currently render **light**.
Adding `color-scheme: dark` to `:root` flips all of those to dark rendering — a
real, visible change on `/games` (and scrollbars app-wide). This contradicts
"the app looks identical except the one Button." **Fix:** either defer
`color-scheme: dark` out of Phase 0, or explicitly carve it out in the success
criteria as an intended (beneficial) exception. Do not leave it as an
unacknowledged violation of "pixel-stable."

### SHOULD-FIX-2 — default Button size is 40px, below the H8 44px minimum
Canonical shadcn `default` size is `h-10` (40px); only `lg` is `h-11` (44px).
`NewGameForm`'s submit is currently `h-tap` (44px) `w-full`. Step 4 says "ensure
it satisfies the H8 44px tap-target minimum" but doesn't say how — using the
`default` size naively **regresses** the tap target 44 → 40px and drops
`w-full`. **Fix:** specify the exact size/className (e.g. `size="lg"` or add
`h-tap w-full` via `className`) so both the 44px target and full-width are
preserved.

### SHOULD-FIX-3 — S1 misses a second stale phrase on the same doc line
`docs/app.md:14` is stale in **two** places: the Pick-column label cell still
reads `"Tailwind + hand-written components"` *and* the Why prose reads
`"Originally planned shadcn/ui; settled on hand-written Tailwind…"`. S1 only
calls out the prose. Update both (and the manifest description) so the doc isn't
internally contradictory after the flip.

### OPTIONAL-1 — confirm the Button file has no `'use client'`
`BottomNav.tsx` is a server component whose sign-in uses an inline `'use server'`
form action (lines 19-22). Rendering `<Button>` there is safe **only** if
`components/ui/button.tsx` stays a plain (no `'use client'`) forwardRef
component — the canonical shadcn Button is exactly that, and no ref/handler is
passed to it here, so the server/client boundary and the server action are
unaffected. Worth a one-line note in Step 4 to keep the implementer from adding
`'use client'` to the Button (some templates do). Low risk.

### OPTIONAL-2 — bundle delta is plausible; state where it lands
`cn`/`twMerge` run at runtime, and because `NewGameForm` is `'use client'`,
`tailwind-merge` (~7KB gz) + `clsx` + `cva` + `@radix-ui/react-slot` ship into
that route's client bundle (not just server). ~10KB added over the ~114KB H8
baseline → well under the 150KB ceiling. The claim is realistic; just note the
delta lands on the `/games` (NewGameForm) first-load, not universally.

---

## Technical corrections summary

- Add `@radix-ui/react-slot` to the Step-1 dependency list (BLOCKING-1).
- Change `--primary` from indigo `239 84% 67%` to blue-500 `217 91% 60%` (or
  preserve `bg-blue-500` via className), and map the sign-in button to `ghost`,
  the submit to a blue `default` (BLOCKING-2).
- Reconcile `color-scheme: dark` with the pixel-stable criterion (SHOULD-FIX-1).
- Pin the migrated Button to 44px + `w-full` explicitly (SHOULD-FIX-2).
- Update both stale phrases on `docs/app.md:14` (SHOULD-FIX-3).

Once BLOCKING-1 and BLOCKING-2 are addressed in the doc, this is safe to
implement; the should-fixes are cheap and should ride along.
