'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function NewGameForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [format, setFormat] = useState<'1v1' | 'team' | 'ffa'>('1v1');
  const [min, setMin] = useState(2);
  const [max, setMax] = useState(2);
  const [k, setK] = useState(32);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-2 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const resp = await fetch('/api/games', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name,
              slug,
              format,
              min_participants: min,
              max_participants: max,
              default_k: k,
            }),
          });
          if (!resp.ok) {
            setErr(await resp.text().catch(() => `error ${resp.status}`));
            return;
          }
          setName('');
          setSlug('');
          router.refresh();
        });
      }}
    >
      <input
        required
        placeholder="Name (e.g. Chess)"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        }}
        className="block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
      />
      <input
        required
        placeholder="slug-here"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        pattern="[a-z0-9\-]+"
        className="block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
      />
      <select
        value={format}
        onChange={(e) => setFormat(e.target.value as never)}
        className="block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
      >
        <option value="1v1">1v1</option>
        <option value="team">team</option>
        <option value="ffa">ffa</option>
      </select>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-slate-400">
          Min
          <input
            type="number"
            min={2}
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
            className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-400">
          Max
          <input
            type="number"
            min={2}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-400">
          K
          <input
            type="number"
            min={1}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
            className="mt-1 block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="h-tap min-w-tap w-full rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add game'}
      </button>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </form>
  );
}
