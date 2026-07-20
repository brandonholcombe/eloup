# Review — Mobile UI/UX Overhaul Plan (umbrella + Phase 0 spec)

## Reviewer: claude-opus-4.8-ux-overhaul-reviewer

Reviews `Agents/TODO/Active/ux-overhaul-plan.md`
(Author: `claude-opus-4.8-ux-overhaul-planner`).

Scope: this is a **plan** review — strategy, sequencing, safety, and whether the
Phase 0 spec in §5 is implementable as written. Not an implementation review.

## Verdict: **Approve-with-changes**

The plan is fundamentally sound. The core technical assumptions check out against
the real codebase: it correctly (if implicitly) targets Tailwind v3, its
interlock/blast-radius analysis is accurate, `align.py lock` will regenerate
cleanly, and — contrary to how nervously the plan frames it — Phase 0 is
genuinely non-regressive. No blocking issues. Several Should-fix corrections
below should be folded into the Phase 0 task doc (`ux0-design-foundation.md`)
before implementation, because a couple of them are traps the plan's own
verification step will not catch.

- **Blocking: 0**
- **Should-fix: 5**
- **Optional: 4**

---

## What the plan gets right (verified)

- **Tailwind version → shadcn setup shape.** `eloup-web/package.json:37` pins
  `tailwindcss@3.4.14`. The §5 manual scaffold (a `components.json`, CSS-var
  colors wired into `tailwind.config.ts`, the `tailwindcss-animate` plugin,
  `cssVariables: true`) is the **correct v3-era shadcn shape**. `tailwindcss-animate`
  is v3-compatible. Had this been Tailwind v4 the whole approach would be wrong
  (no `tailwind.config`, `@theme` in CSS, `tw-animate-css` instead) — the plan
  dodges that pit. Recommend the task doc state "Tailwind v3" explicitly so a
  later implementer doesn't reach for the v4 flow.
- **Interlock blast radius.** The `app` symbol has empty `interlocks`
  (`symbols/manifest.json:150`) and **nothing interlocks on `app.*`** — I scanned
  every symbol; `deployment` interlocks on `architecture.*`, not `app`. So
  `ui_lib: tailwind_handwritten → tailwind_shadcn` ripples nowhere. §3's "no
  change to architecture/auth/rating/deployment" is accurate.
- **`align.py lock` regenerates cleanly.** `scripts/align.py:71-74` hashes only
  the `properties` dict; `:77` folds in doc-file hashes. Flipping `ui_lib`
  changes the property hash → `app` leaf → root; editing `docs/app.md` changes
  its file hash. Both are caught, both regenerate with a single `lock`. Fine.
- **Q-APP-3 really was never decided.** The M4 task doc actually *specified*
  `"ui_lib": "shadcn_ui"` (`Agents/TODO/Active/m4-eloup-web-mvp.md:749`), but the
  shipped manifest is `tailwind_handwritten`. So "the M4 implementer defaulted to
  hand-written" is true, and adopting shadcn is a **reversion to the originally
  planned choice**, not a new bet. Worth stating that framing in the resolution
  note — it lowers the risk profile.
- **Card duplication is real.** `rounded-md border border-slate-800 bg-slate-900`
  appears **21 times** — the count is exactly right (see file-count nit below).
- **Dark-only on `:root` with no `.dark` toggle is correct.** shadcn components
  consume semantic token classes (`bg-background`, `text-muted-foreground`, …);
  they do **not** require a `.dark` class on an ancestor. Applying dark values
  directly on `:root` plus `color-scheme: dark` is the right call. No gotcha here.
- **Phase 0 is test-safe.** `e2e/golden-path.spec.ts` asserts on heading text,
  `/api/health`, the webmanifest, and `sw.js` — not button markup. The unit
  suite renders via `renderToStaticMarkup` and asserts on text/table structure
  (e.g. `tests/unit/compare-drivers-section.test.ts`), not slate classes or
  button internals. Migrating one `Button` (label preserved) breaks nothing. I
  also checked the later emoji→Lucide swap: `nav-active` / `admin-nav-links`
  tests assert on `href`/`label`, not the emoji glyphs, so even Phase 1 is
  test-safe.
- **Migration targets exist.** `components/NewGameForm.tsx` is present and
  `signIn` is referenced in the UI — reasonable Phase 0 proof surfaces.

---

## Should-fix

### S1 — The "no shadcn-CLI dependency" string is in the manifest, not `docs/app.md`
§2 (lines 31-32) and §3 (lines 46-47) say that note lives in `docs/app.md`. It
does not. The exact phrase `Tailwind + hand-written components (no shadcn-CLI
dependency)` is in **`symbols/manifest.json:132`** (the `app.description` prose).
`docs/app.md:14` has *different* wording ("Originally planned shadcn/ui; settled
on hand-written Tailwind components since the M4 UI is small…"). **Both** strings
have to change, and §5 step 5 (lines 134-135) only names `docs/app.md` + the
`ui_lib` property — it never says "update the `app.description` prose in
manifest.json." Add that explicitly.

### S2 — `align.py check` will NOT catch a stale manifest description (this is the trap)
`scripts/align.py` hashes only `properties` and doc files (`:71-77`); it does
**not** hash symbol `description` text. Consequence: if the implementer flips
`ui_lib` and edits `docs/app.md` but forgets the `app.description` prose, the
description will still read "hand-written components (no shadcn-CLI dependency)"
while `ui_lib: tailwind_shadcn` — an internal contradiction — and
`align.py check` will report **green** anyway. The Phase 0 verification (lines
141-143) leans on "`align.py check` OK," which cannot detect this. The task doc
must call out the description edit as a manual, un-verified step.

### S3 — The `--muted-foreground` slate-500→400 "intentional change" is inert in Phase 0
§5 step 2 (lines 122-124) sets `--muted-foreground ≈ slate-400` and frames it as
Phase 0's one deliberate visual change; the verification (line 143) says the app
is "visually unchanged except the intentional `muted-foreground` contrast bump."
But **no existing component consumes `text-muted-foreground`** — the app uses the
literal `text-slate-500` (50 occurrences across `app/` + `components/`). The token
var is inert until a class sweep, and that sweep is itself listed as a **Phase 2**
item (line 80: "contrast (`slate-500`→`400`)"). So in Phase 0 the bump has **zero
visible effect**; the claim is self-contradictory. Fix by either (a) dropping the
"intentional change" framing — Phase 0 is genuinely non-regressive except the one
migrated Button — or (b) moving the value change to land with the Phase 2 sweep.
Note the silver lining: this makes the plan's "no visual regression" goal *more*
solid than it argues, because the entire app renders off literal palette classes;
the token layer is decorative until Phase 1/2 sweep classes onto it.

### S4 — "All copy-in / self-contained" mischaracterizes the dependencies
§3 (lines 49-52) calls `lucide-react`, `class-variance-authority`,
`tailwind-merge`, `clsx`, `tailwindcss-animate`, and Radix "all copy-in /
self-contained." They are **runtime npm dependencies** (installed into
`node_modules`, bundled at build) — only the shadcn component `.tsx` files
(`button.tsx`, etc.) are copy-in. Phase 1 (line 71) also adds **Sonner**, another
runtime dep absent from §3's list. The "PWA/CSP-safe, no CDN" claim is *true*
(everything is bundled, nothing loads from a CDN), but "copy-in" is the wrong
label and it undersells the dependency/bundle footprint that the §6 budget
discussion depends on. Reword to "bundled npm deps (no CDN, CSP-safe) +
copy-in component sources," and add Sonner to the dep inventory.

### S5 — React 19 + pnpm 10 strict peer deps may block the "clean `pnpm install`"
The project runs `react@19.0.0` (`package.json:22`) under `pnpm@10.20.0`
(`:8`). §5 step 1 assumes `pnpm install` "just works." pnpm 10 is strict about
peer ranges, and some Radix / Sonner releases still declare `react: ^18` peers —
you may hit peer-dep warnings or install failures when the `Button` scaffold
pulls `@radix-ui/react-slot`. Recent Radix does support React 19, so this is not
a blocker, but the task doc should pre-empt it: pin React-19-compatible versions
and be ready to add a `pnpm.overrides` / `peerDependencyRules` entry. Don't let
"lockfile updated" read as "guaranteed frictionless."

---

## Optional / nits

- **O1 — File count off.** Phase 1 (line 71) says the card pattern spans "19
  files." It is 21 occurrences across **16 files** (verified). The occurrence
  count is spot-on; correct the file count.
- **O2 — `components.json` `style: "default"`** (§5 step 1, line 110). shadcn
  deprecated `"default"` in favor of `"new-york"`. Irrelevant for a hand-themed
  manual scaffold (style only selects a CLI registry variant), but using the
  current value avoids future confusion.
- **O3 — Set `darkMode: ["class"]` now.** `tailwind.config.ts` has no `darkMode`
  key (defaults to `"media"`). The dark-only-on-`:root` approach works regardless
  (the plan is right), but the plan's own goal of making a light theme "a later
  flip, not a rewrite" (line 38) is better served by establishing
  `darkMode: ["class"]` + a `.dark` wrapper convention in Phase 0, rather than
  migrating the selector strategy later.
- **O4 — SW cache correctness is a per-phase concern, not only Phase 5.** The plan
  parks build-hash cache versioning + the `/offline` page in Phase 5 (line
  96-98). The current SW is cache-first on fingerprinted `/_next/static/*` and
  network-first on navigations (`docs/app.md:68-72`), so new hashed assets *are*
  picked up — but the precached app-shell list can go stale as screens change
  across Phases 1-3. Not blocking; just note SW shell freshness should be
  eyeballed each phase, not deferred wholesale to Phase 5.

---

## Sequencing assessment

Sound. `0 → 1 → 2 → 3/4 → 5` with Phase 0 as a hard gate is the right order, and
**folding the h9 backlog into Phase 2 is the correct call** — re-laying a screen
on primitives and then separately polishing it would double the work on the same
files; doing both in one pass per surface is cheaper and lower-risk. Phase 0's
"migrate exactly one Button as proof" is correctly sized — it exercises the full
pipeline (scaffold → token → config → component → build/test) on the smallest
possible surface. The biggest-risk call in §6 (shadcn defaults diverging from the
dark-slate look, mitigated by pinning tokens before adopting any component) is
the right risk to name and the right mitigation. Nothing needs to move earlier or
later, with the minor O4 caveat above.

**Bottom line:** approve the strategy and the Phase 0 approach. Carry S1–S5 into
`ux0-design-foundation.md` — especially S2 (the alignment tool cannot see the
stale description) and S3 (drop or relocate the muted-foreground claim) — and
Phase 0 is safe to implement.
