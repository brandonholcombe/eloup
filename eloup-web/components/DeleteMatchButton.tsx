'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function DeleteMatchButton({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-4 border-t border-slate-800 pt-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Admin</p>
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Delete this match? Its ELO effect will be reversed.')) return;
          setErr(null);
          start(async () => {
            const resp = await fetch(`/api/matches/${matchId}`, { method: 'DELETE' });
            if (!resp.ok) {
              const body = (await resp.json().catch(() => null)) as { error?: string } | null;
              setErr(body?.error ?? `error ${resp.status}`);
              return;
            }
            router.push('/matches' as never);
          });
        }}
        className="h-tap min-w-tap shadow-none"
      >
        {pending ? 'Deleting…' : 'Delete match'}
      </Button>
      {err && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}
