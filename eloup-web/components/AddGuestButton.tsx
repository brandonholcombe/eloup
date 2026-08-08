'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

// Admin: add a guest entrant (someone with no Discord) by name. Add guests
// BEFORE generating/shuffling the bracket so they're included in the draw.
export function AddGuestButton({ slug, hasBracket }: { slug: string; hasBracket: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setErr(null);
    start(async () => {
      const resp = await fetch(`/api/tournaments/${slug}/guests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!resp.ok) {
        setErr(await resp.text().catch(() => `error ${resp.status}`));
        return;
      }
      setName('');
      router.refresh();
    });
  };

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          maxLength={40}
          placeholder="Guest name (no Discord)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          className="h-tap min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <Button
          type="button"
          disabled={pending || name.trim().length === 0}
          onClick={submit}
          className="h-tap shrink-0 shadow-none"
        >
          {pending ? 'Adding…' : 'Add guest'}
        </Button>
      </div>
      {hasBracket && (
        <p className="mt-1 text-xs text-muted-foreground">
          A bracket already exists — reshuffle (before the first result) to include new guests.
        </p>
      )}
      {err && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}
