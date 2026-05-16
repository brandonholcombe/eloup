'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function NewTournamentForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setErr(null);
        startTransition(async () => {
          const resp = await fetch('/api/tournaments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: name.trim(),
              endsAt: endsAt ? new Date(endsAt).toISOString() : null,
            }),
          });
          if (!resp.ok) {
            setErr(await resp.text().catch(() => `error ${resp.status}`));
            return;
          }
          const { slug } = (await resp.json()) as { slug: string };
          router.push(`/tournaments/${slug}` as never);
        });
      }}
    >
      <label className="block text-sm">
        Name
        <input
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
          placeholder="Spring Cornhole 2026"
        />
      </label>

      <label className="block text-sm">
        Ends (optional)
        <input
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="h-tap min-w-tap w-full rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Creating…' : 'Create tournament'}
      </button>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </form>
  );
}
