'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'eloup.install.dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallHintAndroid() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === 'true') return;
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!evt) return null;

  return (
    <div
      role="dialog"
      aria-label="Install EloUp"
      className="fixed inset-x-0 bottom-20 z-50 mx-auto max-w-md rounded-lg border border-blue-400 bg-slate-900 p-4 text-sm text-slate-100 shadow-lg"
      style={{ marginBottom: 'var(--safe-bottom, 0px)' }}
    >
      <p className="font-medium">Install EloUp</p>
      <p className="mt-1 text-slate-300">One-tap access from your home screen.</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await evt.prompt();
            await evt.userChoice;
            setEvt(null);
          }}
          className="h-tap min-w-tap rounded-md bg-blue-500 px-3 text-xs font-medium text-white hover:bg-blue-400"
        >
          Install
        </button>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, 'true');
            setEvt(null);
          }}
          className="h-tap min-w-tap rounded-md bg-slate-800 px-3 text-xs text-slate-300 hover:bg-slate-700"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
