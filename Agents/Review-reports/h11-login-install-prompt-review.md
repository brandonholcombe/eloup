# Review — H11 Login-triggered PWA install prompt

## Reviewer: claude-opus-4.8-h11-reviewer

Task under review: `h11-login-install-prompt.md`
(`Agents/TODO/Active/h11-login-install-prompt.md`,
Author `claude-opus-4.8-h11-implementer`).

## Verdict: Approve-with-changes

The core architecture is sound and the login-gate mechanism is valid Next.js
App Router. Two real correctness items should be fixed during implementation
(both are things the current design leaves under-specified and could regress),
plus a few smaller notes. Nothing blocks the plan from proceeding.

- Blocking: 0
- Should-fix: 3
- Optional: 4

---

## #1 Login gate mechanism — VALID

**The async-server-wrapper-in-sync-RootLayout pattern is confirmed valid, and
already proven in this codebase.** `app/layout.tsx:23` `RootLayout` is a **sync**
server component, and it already renders `<BottomNav />` (`components/BottomNav.tsx:31`),
which is `export async function BottomNav()` calling `await auth()`. Next.js App
Router allows an async server component anywhere in the server subtree; the
parent need not be async. So `InstallPromptGate` (async, `await auth()`,
rendering `<InstallPrompt signedIn={!!s?.user} />`) is legitimate and needs no
change to `RootLayout`. The `signedIn` boolean is a serializable prop, safe to
pass across the server→client boundary.

**No hydration concern _provided_ `InstallPrompt` starts with `show=false` and
flips it in `useEffect`** (the design says exactly this). Initial server render
and first client render both produce `null`, so there is no mismatch; the
`signedIn` prop must not feed the _initial_ render state directly through a
client-only check (`isStandalone()`/`localStorage`) — those belong in the
effect, as designed.

**Should-fix (semantics): "signed in" is broader than "on login."** The scope
line says "On login, prompt the user…", but gating on `!!session.user` fires for
*every* signed-in page load, because the JWT session cookie persists across
visits. In practice the exposure is bounded (once per user by `DISMISS_KEY`, and
`isStandalone()` suppresses already-installed users), so the effective behavior
is "signed-in, not-installed, not-dismissed users see it once" — which is a
reasonable MVP reading. But the plan should state this explicitly so it isn't
mistaken for firing on the literal login event. If a true "just logged in"
trigger is wanted later, that needs a one-shot signal (e.g. a `?installed=1`
style flag or a sessionStorage marker set on the sign-in redirect) — out of
scope here, but name the decision.

**Optional (cost): `auth()` is now called twice per request** — once in
`BottomNav`, once in `InstallPromptGate`. With `session: { strategy: 'jwt' }`
(`lib/auth.ts:19`) and the `jwt` callback only hitting the DB when `profile` is
present (i.e. during sign-in, not on plain reads), each `auth()` on a normal
request is just a cookie/JWT verification — no DB round-trip. Auth.js v5 `auth()`
is not React-`cache()`-deduped, so it does run twice, but the cost is
negligible. Acceptable; no action required, just don't add more `auth()` callers
casually.

## #2 Platform detection — mostly correct, two fixes

**iPad-as-Mac (`/Macintosh/` + `maxTouchPoints > 1`) is correct and safe.**
Apple ships no touchscreen Macs, and macOS Safari reports `maxTouchPoints === 0`
(a Force Touch/haptic trackpad does not increment it — that counts touchSCREEN
points). So the pair reliably means iPadOS masquerading as Macintosh and will
**not** false-positive a MacBook. `> 1` (vs `> 0`) is a fine, slightly-safer
threshold; iPad reports `5`. A Windows/Chromebook touchscreen won't match
because its UA is not `Macintosh`.

**Should-fix (Android): gate the banner on the `/Android/` UA, not on the
event alone.** The *existing* `InstallHintAndroid.tsx` renders purely when `evt`
is set (`components/InstallHintAndroid.tsx:25`), with **no UA check** — which
means it already fires on **desktop Chrome**, where `beforeinstallprompt` also
fires. The rework must not carry this bug forward: the Android branch should
require `/Android/` in the UA *and* (event OR fallback-instructions). Desktop is
explicitly a non-goal ("on their phone"). The plan lists `/Android/` detection,
so just make the show-condition AND the UA test with the event, rather than
showing on the raw event.

**Should-fix (Android): register the `beforeinstallprompt` listener at mount,
unconditionally — do NOT put it behind the 1.5s delay or the `signedIn`/render
gate.** Chrome fires `beforeinstallprompt` early in page load; if the listener
is only attached after the delay or only once the gated UI decides to render,
the event can fire before the handler exists and be lost, forcing every Android
user into the fallback-instructions path even when a one-tap install was
available. Concretely: attach the `window.addEventListener('beforeinstallprompt',
…)` (with `e.preventDefault()` + stash) in an effect that runs on mount
regardless of the delay; let the delay/`signedIn`/`isStandalone`/`dismissed`
checks gate only *visibility*, not listener registration. (The current
`InstallHintAndroid` gets this right by accident because it mounts immediately
with no delay — the rework's added delay is what introduces the risk.)

**Optional (iOS in-app browsers):** the old iOS component excludes CriOS/FxiOS/
EdgiOS/OPiOS (`components/InstallHintIOS.tsx:11`) because "Share → Add to Home
Screen" is a Safari affordance; showing those steps inside an Instagram/Facebook
WKWebView would be misleading. The task defers this ("Exclude in-app browsers if
simple"). At minimum preserve the existing `!/CriOS|FxiOS|EdgiOS|OPiOS/`
exclusion for the iPhone branch so we don't regress. The iPad-as-Mac branch is
harder to exclude in-app browsers on (Chrome-on-iPad also reports `Macintosh`),
but accept that gap for the MVP.

## #3 Not-installed / not-nagging — sound, one nit

Gating on `isStandalone()` (checks both `navigator.standalone` and the
`display-mode: standalone` media query — matches the manifest's
`"display": "standalone"`, `public/manifest.webmanifest:6`) plus `DISMISS_KEY`
(`eloup.install.dismissed`) plus a delay correctly suppresses installed and
previously-dismissed users. Reading `localStorage`/`matchMedia` in `useEffect`
(client-only) avoids any SSR mismatch since the server can't read them and the
initial render is `null` on both sides. **Optional nit:** clear the delay
`setTimeout` in the effect cleanup to avoid a "set state after unmount" warning
on fast route changes.

## #4 Consolidation — clean

Grep confirms the **only** importers of `InstallHintIOS`/`InstallHintAndroid`
are `app/layout.tsx:4-5` / `:36-37`. Replacing both with `<InstallPromptGate />`
and deleting the two files leaves nothing orphaned. Reusing the shared
`DISMISS_KEY` string preserves prior dismissals. Clean.

## #5 Scope / quality

- **`detectPlatform(ua, maxTouchPoints, standalone)` extraction is worth it.**
  It's the only branch-heavy logic and the one place bugs hide (iPad-as-Mac,
  desktop-Chrome leakage). A pure helper returning `'ios' | 'android' | null`
  unit-tested over {iPhone Safari, iPad-as-Mac, desktop Chrome (→ null),
  Android, standalone (→ null)} is high-value for a small surface. Do it.
- **The prompt won't be lying about installability.** `public/manifest.webmanifest`
  has `name`, `display: standalone`, `start_url`, and 192+512 `any`/`maskable`
  icons; `public/sw.js` has a `fetch` handler and is registered unconditionally
  via `RegisterSW` in the layout. That satisfies Chrome's installability
  criteria (so `beforeinstallprompt` will fire on Android), and iOS install via
  Share is always available. Good.
- **Instruction accuracy is correct:** iOS "Share → Add to Home Screen → Add" is
  right for iOS Safari; Android fallback "browser menu (⋮) → Install app / Add to
  Home screen" is right for Chrome Android.
- **Docs (Should-fix, non-code):** `docs/app.md:73-74` names
  `InstallHintAndroid.tsx` and `InstallHintIOS.tsx` explicitly under "PWA install
  strategy." Since those files are being deleted, update that prose to describe
  the single login-gated `InstallPrompt` + `InstallPromptGate`. The `app` symbol
  (`symbols/manifest.json:133`) only says "hand-rolled service worker +
  manifest.webmanifest for PWA install" — that stays accurate and needs no
  change (do not touch `symbols/`).

---

## Concrete corrections to fold in before/while implementing

1. Register the `beforeinstallprompt` handler on mount, unconditionally;
   gate only visibility behind the delay/`signedIn`/`isStandalone`/`dismissed`.
2. Require `/Android/` UA in the Android show-condition (don't show on the raw
   event) so desktop Chrome — where `beforeinstallprompt` also fires — never
   sees the banner. This also fixes a latent bug in today's `InstallHintAndroid`.
3. Preserve the iPhone in-app-browser exclusion (`!/CriOS|FxiOS|EdgiOS|OPiOS/`);
   accept the iPad-as-Mac in-app gap for MVP.
4. Keep `InstallPrompt` initial state `show=false`, resolve platform/standalone/
   dismissed in `useEffect`; clean up the delay timer on unmount.
5. State in the doc that the gate is "signed-in session" (persists across
   visits), not the literal login event — bounded to once by `DISMISS_KEY`.
6. Update `docs/app.md:73-74` PWA-install prose to name the new component(s).
7. Extract and unit-test `detectPlatform()`.
