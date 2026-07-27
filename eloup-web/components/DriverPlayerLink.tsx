'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';

type LinkedPlayer = {
  id: string;
  display_name: string;
  discord_handle: string;
};

type Hit = {
  id: string;
  display_name: string;
  discord_handle: string;
  avatar_url: string | null;
};

type Props = {
  driverId: string;
  currentLink: LinkedPlayer | null;
};

const DEBOUNCE_MS = 300;

export function DriverPlayerLink({ driverId, currentLink }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // Track the most recent search request so an out-of-order response
  // for a stale query string can't overwrite results from a newer one.
  const reqSeq = useRef(0);

  useEffect(() => {
    if (currentLink) {
      // Unlink UI doesn't render the search input; reset state so a
      // future re-link starts clean.
      setQuery('');
      setResults([]);
      return;
    }
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(
          `/api/players/search?q=${encodeURIComponent(query)}`,
          { cache: 'no-store' },
        );
        if (!resp.ok) return;
        const data = (await resp.json()) as { players?: Hit[] };
        if (seq === reqSeq.current) setResults(data.players ?? []);
      } catch {
        // Network errors are non-fatal — the operator can retype to retry.
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, currentLink]);

  const submit = (playerId: string | null) =>
    start(async () => {
      setErr(null);
      const resp = await fetch(`/api/racing/drivers/${driverId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => null)) as { error?: string } | null;
        setErr(data?.error ?? `error ${resp.status}`);
        return;
      }
      setQuery('');
      setResults([]);
      // router.refresh() re-SSRs the driver profile page so the
      // currentLink prop flips from null → {…} (or vice versa). That
      // re-render is what switches this component between the Search
      // and Unlink views below; no client-side currentLink state needed.
      router.refresh();
    });

  return (
    <Card className="mt-3 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-slate-400">
        Admin · link Discord player
      </p>
      {currentLink ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span>
            Linked to {currentLink.display_name}{' '}
            <span className="text-slate-400">(@{currentLink.discord_handle})</span>
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(null)}
            className="h-tap min-w-tap rounded-md bg-red-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Unlink'}
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            inputMode="text"
            placeholder="Search by handle or display name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={64}
            disabled={pending}
            className="mt-2 h-tap w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm"
          />
          {results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => submit(r.id)}
                    className="flex h-tap w-full items-center justify-between rounded-md border border-slate-800 bg-slate-950 px-3 text-left text-sm hover:bg-slate-800 disabled:opacity-50"
                  >
                    <span>{r.display_name}</span>
                    <span className="text-xs text-slate-400">@{r.discord_handle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!pending && query.trim().length > 0 && results.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">No matches.</p>
          )}
        </>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </Card>
  );
}
