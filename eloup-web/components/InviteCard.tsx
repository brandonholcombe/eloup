'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function InviteCard({
  slug,
  initialToken,
  appDomain,
}: {
  slug: string;
  initialToken: string | null;
  appDomain: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(initialToken);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const joinUrl = token ? `${appDomain.replace(/\/$/, '')}/tournaments/join/${token}` : null;

  return (
    <section className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Invite link</h2>
      {joinUrl ? (
        <>
          <p className="mt-2 break-all rounded bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200">
            {joinUrl}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (joinUrl) navigator.clipboard.writeText(joinUrl).catch(() => {});
              }}
              className="h-tap min-w-tap rounded-md bg-slate-700 px-3 text-xs text-white"
            >
              Copy
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setErr(null);
                  const resp = await fetch(`/api/tournaments/${slug}/invite`, { method: 'POST' });
                  if (!resp.ok) {
                    setErr(await resp.text().catch(() => `error ${resp.status}`));
                    return;
                  }
                  const body = (await resp.json()) as { token: string };
                  setToken(body.token);
                  router.refresh();
                })
              }
              className="h-tap min-w-tap rounded-md bg-slate-700 px-3 text-xs text-white disabled:opacity-50"
            >
              Rotate
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setErr(null);
                  const resp = await fetch(`/api/tournaments/${slug}/invite`, { method: 'DELETE' });
                  if (!resp.ok) {
                    setErr(await resp.text().catch(() => `error ${resp.status}`));
                    return;
                  }
                  setToken(null);
                  router.refresh();
                })
              }
              className="h-tap min-w-tap rounded-md bg-slate-800 px-3 text-xs text-red-300 disabled:opacity-50"
            >
              Revoke
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setErr(null);
              const resp = await fetch(`/api/tournaments/${slug}/invite`, { method: 'POST' });
              if (!resp.ok) {
                setErr(await resp.text().catch(() => `error ${resp.status}`));
                return;
              }
              const body = (await resp.json()) as { token: string };
              setToken(body.token);
              router.refresh();
            })
          }
          className="mt-2 h-tap min-w-tap rounded-md bg-blue-500 px-3 text-sm text-white disabled:opacity-50"
        >
          {isPending ? 'Generating…' : 'Generate invite link'}
        </button>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </section>
  );
}
