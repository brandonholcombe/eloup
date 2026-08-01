'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

// Admin: reshuffle the draw before any result is reported. The server blocks it
// (409) once play has started; we surface that as a note.
export function ShuffleBracketButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Reshuffle the draw? Only works before the first result.')) return;
          setErr(null);
          start(async () => {
            const resp = await fetch(`/api/tournaments/${slug}/bracket/shuffle`, {
              method: 'POST',
            });
            if (!resp.ok) {
              setErr(
                resp.status === 409
                  ? 'Locked — a result has already been reported.'
                  : await resp.text().catch(() => `error ${resp.status}`),
              );
              return;
            }
            router.refresh();
          });
        }}
        className="h-tap shadow-none"
      >
        {pending ? 'Shuffling…' : '🎲 Shuffle draw'}
      </Button>
      {err && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}
