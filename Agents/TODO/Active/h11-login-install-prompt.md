# H11 — Login-triggered PWA install prompt (simple instructions)

## Author: claude-opus-4.8-h11-implementer
## Status: Complete

## Outcome (2026-08-07) — SHIPPED, verified live

Login-gated `InstallPrompt` + `InstallPromptGate`; pure `detectPlatform` (5 tests);
old hints removed; docs + lock updated. Verified: signed-in iOS shows the Share →
Add-to-Home-Screen steps; signed-out shows nothing. vitest 362→367.

## Reviewer findings folded (2026-08-07)

Review at `Agents/Review-reports/h11-login-install-prompt-review.md`: **Approve-
with-changes** — 0 blocking, 3 should-fix. Login-gate mechanism confirmed valid
(BottomNav already uses async-`auth()`-in-sync-layout); iPad-as-Mac detection
safe; app genuinely installable; only the layout imports the old components.
Folded:
- **S1:** register the `beforeinstallprompt` listener at mount **unconditionally**
  (its own effect), NOT behind the 1.5s delay/signedIn gate — else Chrome may
  fire it before the handler attaches and everyone falls to the fallback path.
- **S2:** show the Android banner only when the UA matches `/Android/`, not merely
  on the captured event — the current `InstallHintAndroid` leaks onto desktop
  Chrome (where `beforeinstallprompt` also fires); the rework must gate on
  platform === 'android'.
- **S3:** update `docs/app.md` prose (names the two deleted components); the `app`
  symbol stays accurate (no `symbols/` edit).

## Scope (user, 2026-08-07)

On login, prompt the user to add the web app to their phone home screen for a
better experience, with a simple set of instructions. Reworks the existing
`InstallHintIOS`/`InstallHintAndroid` into one cohesive, login-gated prompt and
fixes the gaps the H8 review flagged.

## Current state

- `InstallHintIOS` + `InstallHintAndroid` render globally in `app/layout.tsx` and
  fire on ANY load (anonymous or not). iOS shows "Share → Add to Home Screen";
  Android uses `beforeinstallprompt`. Shared `DISMISS_KEY` (`eloup.install.dismissed`),
  both dismissible + gated on `isStandalone()`.
- Gaps (H8 review, deferred): iPad returns false (`isIosSafari` — iPadOS reports a
  `Macintosh` UA); fires instantly (nag-forward); Android has no fallback when
  `beforeinstallprompt` doesn't fire; not tied to login.

## Design — one `InstallPrompt` (client) + `InstallPromptGate` (server)

- **`components/InstallPromptGate.tsx`** (async server): `const s = await auth();`
  render `<InstallPrompt signedIn={!!s?.user} />`. Keeps the auth read isolated so
  `RootLayout` need not change to async.
- **`components/InstallPrompt.tsx`** (client): show only when
  `signedIn && !isStandalone() && !dismissed`, after a short delay (~1.5s, so it's
  not nag-instant). Reuse `DISMISS_KEY` so a prior dismissal still counts.
- **Platform detection:**
  - **iOS/iPadOS Safari:** `/iPad|iPhone|iPod/` OR (`/Macintosh/` + `navigator.maxTouchPoints > 1`) → the iPad-as-Mac case (fixes the H8 gap). Exclude in-app browsers if simple.
  - **Android:** `/Android/`. Capture `beforeinstallprompt` for a one-tap **Install** button; if it never fires, show the fallback instructions.
  - Other/desktop: don't show (mobile-first; the ask is "on their phone").
- **Instructions (simple, numbered):**
  - iOS/iPad: "1. Tap the Share button (the box with an ↑). 2. Choose **Add to
    Home Screen**. 3. Tap **Add**."
  - Android (no native prompt): "Open your browser menu (⋮) → **Install app** /
    **Add to Home screen**."
  - Android (native prompt available): an **Install** button (runs `evt.prompt()`).
- **UI:** the existing bottom-sheet card style (`fixed bottom-20`, safe-area
  margin, `role="dialog"`, blue border), a clear title ("Add EloUp to your phone —
  best experience"), the steps, and a **Not now** dismiss (writes `DISMISS_KEY`).
  44px targets, tokens.
- **Layout:** replace `<InstallHintIOS />` + `<InstallHintAndroid />` with
  `<InstallPromptGate />`. Remove the two old components (orphaned).

## Testing / verification
- `pnpm lint`/`typecheck`/`build`/`test` green (no logic tests needed; pure UI).
  If a small pure `detectPlatform(ua, maxTouchPoints, standalone)` helper is
  extracted, unit-test it (iPhone, iPad-as-Mac, Android, desktop, standalone).
- Verify via the local harness with a forged session (signed-in): the prompt
  appears (emulating iOS UA), shows the right instructions, dismiss persists, and
  does NOT appear when signed-out or in standalone display-mode.
- No schema/symbol change (though `app.md` notes the PWA/install-hint strategy —
  update that prose if it names the old components).

## Non-goals
Desktop install, re-prompting after dismissal, analytics on install rate, a
full onboarding flow. Just a clear, login-gated, dismissible install nudge.

## Review gate
Edits `eloup-web/` (layout + components). Needs an independent review by a
different agent than `## Author:`, referencing `h11-login-install-prompt.md`,
before implementation — focus on the platform detection correctness (iPad-as-Mac,
standalone, not showing when signed-out) and that the login gate works via the
server wrapper without making RootLayout async.
