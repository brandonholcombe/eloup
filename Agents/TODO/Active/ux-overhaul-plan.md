# EloUp — Mobile UI/UX Overhaul Plan (umbrella)

## Author: claude-opus-4.8-ux-overhaul-planner
## Status: In Progress

## Reviewer findings folded (2026-07-19)

Independent review at `Agents/Review-reports/ux-overhaul-plan-review.md`
(Reviewer: `claude-opus-4.8-ux-overhaul-reviewer`) returned
**Approve-with-changes** — 0 blocking, 5 should-fix, 4 optional. Strategy,
sequencing, Tailwind-v3 targeting, interlock blast radius (none), test-safety,
and the h9→Phase-2 fold were all verified sound. The five should-fix corrections
are folded below:
- **S1/S2 (trap):** the "no shadcn-CLI dependency" phrase lives in
  `symbols/manifest.json` `app.description` **prose**, not `docs/app.md`, and
  `align.py` does **not** hash descriptions — so a stale description passes
  `check` green. The description edit is now an explicit, manually-verified
  Phase 0 step (§3, §5.5).
- **S3:** the `--muted-foreground` slate-500→400 bump is **inert** in Phase 0
  (nothing consumes `text-muted-foreground`; 50 literal `text-slate-500`
  usages), so it's moved to the Phase 2 class sweep; Phase 0 is now framed as
  genuinely non-regressive.
- **S4:** dependencies reworded — bundled npm deps (no CDN, CSP-safe) + copy-in
  component sources; Sonner added to the inventory.
- **S5:** React 19 + pnpm 10 strict peers may block a clean install; pin
  React-19-compatible versions and be ready with `pnpm.overrides`.
- Optionals folded: card pattern is 16 files (not 19); `components.json`
  `style: "new-york"`; set `darkMode: ["class"]` in Phase 0; eyeball SW
  app-shell freshness each phase.

> Umbrella planning artifact for the mobile UI/UX overhaul. It needs an
> independent review (different agent → `Agents/Review-reports/`) before Phase 0
> implementation begins. Each subsequent phase gets its **own** task doc with its
> **own** review, so the review gate stays protective per phase. Do NOT mark this
> umbrella `Complete` until all phases land.

---

## 1. Origin & goal

A three-agent mobile UI/UX review (2026-07-19) found a solid mobile foundation
but an ad-hoc, unsystematized UI. **H8** (shipped + deployed, commit `4ec8488`)
fixed the mechanics — real 44px tap targets (`h-tap` config bug), safe-area body
padding, active-tab highlight, back links, loading skeletons. This overhaul
addresses the **system** above those mechanics.

**Goal:** evolve "functional MVP Tailwind" into a cohesive, tokenized,
component-driven product **without changing the dark-slate aesthetic** — an
evolutionary "systematize + polish," not a visual reinvention.

## 2. Locked decisions (this session, 2026-07-19)

- **Ambition: systematize + polish.** Keep the dark-slate look; tokenize it,
  extract primitives, enforce consistency + a11y, apply everywhere.
- **Component layer: adopt shadcn/ui.** Reverses the current
  `app.ui_lib: tailwind_handwritten`. **Resolves Q-APP-3** — and is actually a
  **reversion to the originally planned choice**: the M4 task doc specified
  `"ui_lib": "shadcn_ui"` (`m4-eloup-web-mvp.md:749`) but the implementer
  shipped hand-written Tailwind. So this is not a new bet; it lowers the risk
  profile. Note the "no shadcn-CLI dependency" wording lives in **two** places
  that both must change: `symbols/manifest.json` `app.description` prose AND
  `docs/app.md:14` (different wording) — see §3.
- **Icons: real inline-SVG set (Lucide).** Replaces emoji in nav + UI controls
  (emoji may remain for playful game/category tags at implementer discretion).
- **Dark mode only.** shadcn ships light+dark via CSS vars; we wire dark only,
  structured so a light theme is a later flip, not a rewrite.
- **Projection surface (§4.2 `/projection/...`) is DEFERRED** out of this
  overhaul — a distinct big-screen surface entangled with M7 heart-rate; it gets
  its own milestone later.

## 3. Symbol & dependency implications (must be handled in Phase 0)

- **`app` symbol change:** `ui_lib: tailwind_handwritten` → `tailwind_shadcn`.
  Update `symbols/manifest.json` (app properties), and edit BOTH the stale
  "no shadcn-CLI dependency" strings — the `app.description` **prose** in
  `symbols/manifest.json` **and** the different wording in `docs/app.md:14` —
  then run `python scripts/align.py lock` in the **same commit** as the Phase 0
  code. Record the Q-APP-3 resolution.
- **⚠️ Alignment blind spot (reviewer S2):** `scripts/align.py` hashes only
  `properties` + doc files, **not** symbol `description` text. So if the
  `app.description` prose is left stale, `align.py check` still reports **green**
  while the description contradicts `ui_lib: tailwind_shadcn`. The description
  edit is a **manual, un-verified** step — the Phase 0 doc must call it out and
  the implementer must eyeball it; the check cannot.
- **New dependencies — bundled npm deps (installed to `node_modules`, bundled at
  build; no CDN, so PWA/CSP-safe) plus copy-in shadcn component `.tsx` sources:**
  `lucide-react`, `class-variance-authority`, `tailwind-merge`, `clsx`,
  `tailwindcss-animate`, `sonner` (toasts, Phase 1), and Radix primitives pulled
  per shadcn component. Adds `components.json` and `lib/utils.ts` (`cn()`).
- **No change** to: `architecture`, `auth`, `rating`, `deployment`, DB, or the
  StatefulSet. This is presentation-layer only.

## 4. Phases

Each phase is its own task doc in `Agents/TODO/Active/` (suggested slugs below)
with an independent review. Phases are sequential; Phase 0 gates all others.

### Phase 0 — Design foundation  (`ux0-design-foundation.md`) — SPEC BELOW
shadcn initialized; the dark-slate aesthetic re-expressed as semantic tokens;
`app` symbol + lock updated. **No visual regression** — the app should look
essentially identical, but now be driven by tokens. Detailed spec in §5.

### Phase 1 — Component primitives  (`ux1-primitives.md`)
Adopt + restyle the shadcn primitives the app actually needs — Button, Card,
Input, Select, Badge, Tabs, Dialog/Sheet, Skeleton (replace the H8 hand-rolled
one), Sonner (toasts). Swap emoji → Lucide in `BottomNav`/controls. Replace the
**21 duplicated `rounded-md border border-slate-800 bg-slate-900` card strings**
(16 files) and all inline buttons/chips with primitives. Outcome: one source of
truth per UI element; net LOC likely down.

### Phase 2 — Screen redesign  (`ux2-screens.md`)  *(subsumes the h9 backlog)*
Re-lay each surface on the primitives and **fold in every deferred h9 P2 item**:
match-entry ergonomics (1v1 auto-seed, one-tap winner, `inputMode="numeric"` +
clamping), sticky bottom confirm bar on `matches/[id]`, list-row `min-h-tap`,
`overflow-x-auto` on the race/compare tables, `role="alert"` on error text,
contrast (`slate-500`→`400`), floor 9–11px text to ~12px. Screens: leaderboards,
profile (stat tiles + ELO sparkline), match detail, racing dashboard,
tournaments, games. **`h9-mobile-ux-polish.md` is superseded by this phase — do
not create it separately.**

### Phase 3 — Data visualization  (`ux3-dataviz.md`)
ELO history charts, leaderboard sparklines, and the race/lap charts rebuilt on
the token palette and the project's dataviz conventions — legible at ~390px,
touch-usable, consistent categorical colors. `LapChart` already responsive; bring
it under the shared palette + fix its ~24px chip targets and 9px axis labels.

### Phase 4 — Motion & delight  (`ux4-motion.md`)
`tailwindcss-animate` + Radix transitions: route/entry transitions, tap feedback,
ELO-change count-up, a win moment (confetti/haptic), skeleton→content fade.
Respect `prefers-reduced-motion`.

### Phase 5 — A11y + PWA polish  (`ux5-a11y-pwa.md`)
WCAG AA contrast + focus-visible + reduced-motion audit; SW: dedicated `/offline`
fallback page (stop the misleading leaderboards fallback), build-hash cache
versioning; iPad install-hint detection (`maxTouchPoints`); splash screens.

### (Deferred) Phase 6 — Projection surface
Out of scope for this overhaul; its own milestone with M7.

## 5. Phase 0 detailed spec (the first reviewable/implementable unit)

**Intent:** stand up the token system + shadcn scaffolding with the app looking
the same. Migrate exactly ONE primitive (Button) end-to-end as proof; full
migration is Phase 1.

1. **Scaffold shadcn (manual, no interactive CLI in-repo) — Tailwind v3 flow:**
   the repo is `tailwindcss@3.4.14`, so use the v3-era shape (a
   `tailwind.config.ts`, CSS-var colors, `tailwindcss-animate`) — **not** the
   Tailwind v4 flow (`@theme` in CSS, `tw-animate-css`). Add `components.json`
   (style: **new-york**, baseColor: slate, cssVariables: true, rsc: true,
   aliases matching `@/components` + `@/lib/utils`), create `lib/utils.ts`
   exporting `cn()` (clsx + tailwind-merge). Add deps to `package.json`:
   `lucide-react`, `class-variance-authority`, `tailwind-merge`, `clsx`,
   `tailwindcss-animate`.
   - **⚠️ Install friction (reviewer S5):** the repo runs `react@19.0.0` under
     `pnpm@10.20.0` (strict peers). Some Radix/Sonner releases still declare
     `react: ^18` peers, so `pnpm install` may warn or fail when the Button
     scaffold pulls `@radix-ui/react-slot`. Pin React-19-compatible versions and
     be ready to add a `pnpm.overrides` / `peerDependencyRules` entry — do not
     assume a frictionless install.
2. **Token theme (dark-only):** in `app/globals.css`, define shadcn's HSL CSS
   vars (`--background --foreground --card --popover --primary --secondary
   --muted --accent --destructive --border --input --ring --radius`) mapped to
   the CURRENT palette so nothing visually shifts: `--background` ≈ slate-950,
   `--card` ≈ slate-900, `--border` ≈ slate-800, `--foreground` ≈ slate-100.
   **`--muted-foreground` = slate-500 in Phase 0 (reviewer S3)** — match today's
   literal usage so Phase 0 is truly non-regressive. The slate-500→400 contrast
   bump lands in the **Phase 2 class sweep**, where components actually switch to
   `text-muted-foreground` (nothing consumes that token until then — there are
   50 literal `text-slate-500` usages today, so changing the var now would have
   zero visible effect). Choose a `--primary` accent (propose a single brand
   accent — implementer to pick; default a blue/indigo consistent with
   `themeColor: #0f172a`). Since dark-only, apply the vars on `:root` and set
   `color-scheme: dark`.
3. **tailwind.config:** switch relevant colors to reference the CSS vars per the
   shadcn pattern (`background`, `foreground`, `card`, `primary`, `border`,
   `ring`, etc.), wire `borderRadius` off `--radius`, add the `tailwindcss-animate`
   plugin. Keep the existing `height/minHeight/minWidth.tap` (H8) and safe-area
   spacing. **Set `darkMode: ["class"]` (reviewer O3)** — the config has no
   `darkMode` key today (defaults to `"media"`); establishing the class strategy
   + a `.dark` wrapper convention now makes the future light theme a flip, not a
   selector migration. Add a modest type scale only if it does not restyle
   existing text.
4. **Proof migration:** generate the shadcn `Button` into `components/ui/button.tsx`,
   theme it to match the current button look, and replace buttons in ONE simple
   surface (e.g. the sign-in button + `NewGameForm` submit) to validate the
   pipeline end-to-end. Do not migrate the rest (Phase 1).
5. **Symbol + docs:** update `app.ui_lib` → `tailwind_shadcn`; edit BOTH stale
   "no shadcn-CLI dependency" strings — the `app.description` **prose** in
   `symbols/manifest.json` AND the different wording in `docs/app.md:14`
   (reviewer S1); record Q-APP-3 resolved; `align.py lock`; commit manifest +
   lock + code together.
   - **⚠️ (reviewer S2):** `align.py` does not hash symbol descriptions, so a
     stale `app.description` passes `check` green while contradicting the new
     `ui_lib`. The description edit is a **manual, un-verified** step — eyeball
     it; do not rely on `align.py check` to catch it.

**Non-goals for Phase 0:** no screen redesign, no emoji removal, no mass
component migration, no new motion. Purely foundation.

**Verification:** `pnpm lint` / `typecheck` / `build` / `test` all green;
`align.py check` OK **plus a manual read of `app.description`** (S2 — the check
can't see it); manual 390px smoke — the app is visually unchanged except the one
migrated Button (the `muted-foreground` bump is deferred to Phase 2, so Phase 0
is otherwise pixel-stable).

## 6. Sequencing, risk, gating

- **Order:** 0 → 1 → 2 → 3/4 (parallelizable) → 5. Phase 0 is a hard gate.
- **Biggest risk:** shadcn's default component styling diverging from the
  dark-slate look. Mitigation: token mapping in Phase 0 pins colors to the
  current palette *before* any component is adopted, so primitives inherit the
  existing look rather than shadcn defaults.
- **Second risk:** dependency/bundle growth vs the ≤150KB first-load budget.
  Mitigation: Radix primitives are per-component and tree-shaken; measure
  first-load JS each phase (H8 baseline: 100–114KB) and flag regressions.
- **Review gate:** every phase edits `eloup-web/`, so each needs its own review
  report by a different agent before implementation. This umbrella needs a review
  of the plan itself first.

## 7. What I need to proceed

1. Independent review of THIS plan → `Agents/Review-reports/ux-overhaul-plan-review.md`.
2. On approval: create `ux0-design-foundation.md` (concrete, from §5), get it
   reviewed, implement Phase 0 (incl. the `app` symbol + lock change).
3. Proceed phase by phase, each its own task doc + review.
