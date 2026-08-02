'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export type CardEntrant = { id: string | null; name: string; isVoid: boolean; isWinner: boolean };

// One match card in the bracket tree. For a ready match an admin taps a player's
// name to report them as the winner (or flips "w/o" for a walkover — no ELO).
export function BracketCard({
  slug,
  nodeId,
  p1,
  p2,
  status,
  canReport,
  champion,
  width,
  height,
}: {
  slug: string;
  nodeId: string;
  p1: CardEntrant;
  p2: CardEntrant;
  status: 'pending' | 'ready' | 'bye' | 'done';
  canReport: boolean;
  champion: boolean;
  width: number;
  height: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [walkover, setWalkover] = useState(false);

  const report = (winnerId: string) =>
    start(async () => {
      const resp = await fetch(`/api/tournaments/${slug}/bracket/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId, winnerId, walkover }),
      });
      if (resp.ok) router.refresh();
    });

  const row = (e: CardEntrant, tappable: boolean) => {
    const label = e.id ? e.name : e.isVoid ? 'bye' : 'TBD';
    const cls = e.isWinner
      ? 'text-emerald-400 font-medium'
      : e.id
        ? 'text-slate-100'
        : 'text-muted-foreground';
    if (tappable && e.id) {
      return (
        <button
          type="button"
          disabled={pending}
          onClick={() => report(e.id!)}
          className={`block w-full truncate px-2 py-1 text-left text-xs hover:bg-slate-800 disabled:opacity-50 ${cls}`}
        >
          {label}
        </button>
      );
    }
    return (
      <span className={`block truncate px-2 py-1 text-xs ${cls}`}>
        {label}
        {e.isWinner && ' ✓'}
      </span>
    );
  };

  return (
    <div
      style={{ width, height }}
      className={`overflow-hidden rounded-md border bg-card ${
        champion ? 'border-blue-500' : status === 'ready' ? 'border-slate-600' : 'border-border'
      }`}
    >
      {row(p1, canReport)}
      <div className="border-t border-border" />
      {row(p2, canReport)}
      {canReport && (
        <label className="flex items-center gap-1 px-2 text-[9px] text-muted-foreground">
          <input
            type="checkbox"
            checked={walkover}
            onChange={(e) => setWalkover(e.target.checked)}
            className="h-2.5 w-2.5"
          />
          w/o
        </label>
      )}
    </div>
  );
}
