'use client';

import { useEffect, useState } from 'react';
import { detectPlatform, type Platform } from '@/lib/pwa/detect';

const DISMISS_KEY = 'eloup.install.dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

// Login-gated PWA install nudge (H11). Shows after sign-in on a phone that hasn't
// installed/dismissed, with simple platform-specific steps.
export function InstallPrompt({ signedIn }: { signedIn: boolean }) {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<Platform>('other');
  const [bip, setBip] = useState<BeforeInstallPromptEvent | null>(null);

  // S1: capture beforeinstallprompt at mount, unconditionally — Chrome may fire
  // it before the delayed show logic runs.
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setBip(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!signedIn || isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === 'true') return;
    const plat = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    if (plat === 'other') return; // don't prompt desktop (S2)
    setPlatform(plat);
    const t = setTimeout(() => setShow(true), 1500); // not nag-instant
    return () => clearTimeout(t);
  }, [signedIn]);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Add EloUp to your phone"
      className="fixed inset-x-0 bottom-20 z-50 mx-auto max-w-md rounded-lg border border-blue-400 bg-slate-900 p-4 text-sm text-slate-100 shadow-lg"
      style={{ marginBottom: 'var(--safe-bottom, 0px)' }}
    >
      <p className="font-medium">Add EloUp to your phone</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Install it for a full-screen, one-tap experience.
      </p>

      {platform === 'ios' ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-300">
          <li>
            Tap the <strong>Share</strong> button (the square with an ↑) in the toolbar.
          </li>
          <li>
            Scroll and choose <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong>Add</strong>.
          </li>
        </ol>
      ) : bip ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={async () => {
              await bip.prompt();
              await bip.userChoice;
              dismiss();
            }}
            className="h-tap min-w-tap rounded-md bg-blue-500 px-3 text-xs font-medium text-white hover:bg-blue-400"
          >
            Install
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="h-tap min-w-tap rounded-md bg-slate-800 px-3 text-xs text-slate-300 hover:bg-slate-700"
          >
            Not now
          </button>
        </div>
      ) : (
        <p className="mt-2 text-slate-300">
          Open your browser menu <span aria-hidden>⋮</span> and choose{' '}
          <strong>Install app</strong> (or <strong>Add to Home screen</strong>).
        </p>
      )}

      {(platform === 'ios' || !bip) && (
        <button
          type="button"
          onClick={dismiss}
          className="mt-3 h-tap min-w-tap rounded-md bg-slate-800 px-3 text-xs text-slate-300 hover:bg-slate-700"
        >
          Not now
        </button>
      )}
    </div>
  );
}
