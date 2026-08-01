'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

// Admin control on a ready bracket node: tap the winner to record a played
// result (creates a real Smash match + ELO). Optional walkover = advance a
// no-show with no match/ELO.
export function ReportBracketNode({
  slug,
  nodeId,
  p1,
  p2,
}: {
  slug: string;
  nodeId: string;
  p1: { id: string; name: string };
  p2: { id: string; name: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [walkover, setWalkover] = useState(false);

  const report = (winnerId: string) =>
    start(async () => {
      setErr(null);
      const resp = await fetch(`/api/tournaments/${slug}/bracket/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId, winnerId, walkover }),
      });
      if (!resp.ok) {
        setErr(await resp.text().catch(() => `error ${resp.status}`));
        return;
      }
      router.refresh();
    });

  return (
    <div className="mt-2">
      <p className="text-xs text-muted-foreground">
        {walkover ? 'Advance (walkover — no ELO):' : 'Winner:'}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => report(p1.id)}
          className="h-tap w-full shadow-none"
        >
          {p1.name}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => report(p2.id)}
          className="h-tap w-full shadow-none"
        >
          {p2.name}
        </Button>
      </div>
      <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={walkover}
          onChange={(e) => setWalkover(e.target.checked)}
        />
        no-show / walkover (no ELO)
      </label>
      {err && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}
