'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { GAME_CATEGORIES } from '@/lib/games/categories';

type Props = {
  gameId: string;
  currentCategory: string;
};

// Per-row admin editor on /games. Mirrors H5's DriverPlayerLink shape:
// useRouter + useTransition + router.refresh() so the server-rendered
// row re-fetches its currentCategory after a successful PATCH. The
// Save button only appears when the dropdown's value differs from
// currentCategory — operator cannot accidentally submit a no-op.
//
// `resp.text().catch(...)` surfaces the raw response body for failed
// requests. That body is JSON for 400/404/etc., so an operator sees the
// stringified envelope rather than a parsed message. Same pattern as
// NewGameForm; cleaning that up sitewide is out of scope for H7.
export function GameCategoryEditor({ gameId, currentCategory }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<string>(currentCategory);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = value !== currentCategory;

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-tap rounded-md border border-slate-700 bg-slate-900 px-1 text-xs"
        aria-label="category"
      >
        {GAME_CATEGORIES.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.label}
          </option>
        ))}
      </select>
      {dirty && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr(null);
              const resp = await fetch(`/api/games/${gameId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ category: value }),
              });
              if (!resp.ok) {
                setErr(await resp.text().catch(() => `error ${resp.status}`));
                return;
              }
              router.refresh();
            })
          }
          className="h-tap min-w-tap rounded-md bg-blue-500 px-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? '…' : 'Save'}
        </button>
      )}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}
