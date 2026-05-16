'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'eloup.install.dismissed';

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIos && isSafari;
}

function isStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

export function InstallHintIOS() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIosSafari()) return;
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === 'true') return;
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Install EloUp"
      className="fixed inset-x-0 bottom-20 z-50 mx-auto max-w-md rounded-lg border border-blue-400 bg-slate-900 p-4 text-sm text-slate-100 shadow-lg"
      style={{ marginBottom: 'var(--safe-bottom, 0px)' }}
    >
      <p className="font-medium">Install EloUp</p>
      <p className="mt-1 text-slate-300">
        Tap the <span aria-hidden>⎙</span> Share button → <strong>Add to Home Screen</strong>.
      </p>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, 'true');
          setShow(false);
        }}
        className="mt-3 h-tap min-w-tap rounded-md bg-slate-800 px-3 text-xs text-slate-300 hover:bg-slate-700"
      >
        Not now
      </button>
    </div>
  );
}
