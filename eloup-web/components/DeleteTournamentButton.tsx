'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function DeleteTournamentButton({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Delete "${name}" and ALL its matches + bracket? ELO from its matches will be reversed. This cannot be undone.`,
            )
          )
            return;
          setErr(null);
          start(async () => {
            const resp = await fetch(`/api/tournaments/${slug}`, { method: 'DELETE' });
            if (!resp.ok) {
              setErr(await resp.text().catch(() => `error ${resp.status}`));
              return;
            }
            router.push('/tournaments' as never);
          });
        }}
        className="h-tap min-w-tap shadow-none"
      >
        {pending ? 'Deleting…' : 'Delete tournament'}
      </Button>
      {err && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}
