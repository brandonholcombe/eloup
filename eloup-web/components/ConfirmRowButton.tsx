'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ConfirmRowButton({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setErr(null);
          startTransition(async () => {
            const resp = await fetch(`/api/matches/${matchId}/confirm`, {
              method: 'POST',
            });
            if (!resp.ok) {
              const body = await resp.text().catch(() => '');
              setErr(body || `confirm failed (${resp.status})`);
              return;
            }
            router.refresh();
          });
        }}
        className="h-tap min-w-tap rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Confirming…' : 'Confirm my row'}
      </button>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}
