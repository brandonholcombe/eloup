'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function AdminForceConfirmButton({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-4 border-t border-slate-800 pt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Admin</p>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (
            !window.confirm(
              'Force-confirm this match? Any unconfirmed rows will be marked confirmed and the ELO transaction will run immediately.',
            )
          )
            return;
          setErr(null);
          startTransition(async () => {
            const resp = await fetch(`/api/matches/${matchId}/admin-confirm`, { method: 'POST' });
            if (!resp.ok) {
              const body = await resp.text().catch(() => '');
              setErr(body || `force-confirm failed (${resp.status})`);
              return;
            }
            router.refresh();
          });
        }}
        className="h-tap min-w-tap rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Confirming…' : 'Force confirm (admin)'}
      </button>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}
