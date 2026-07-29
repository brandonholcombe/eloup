'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function ConfirmRowButton({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div>
      <Button
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
        className="h-tap min-w-tap shadow-none"
      >
        {isPending ? 'Confirming…' : 'Confirm my row'}
      </Button>
      {err && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}
