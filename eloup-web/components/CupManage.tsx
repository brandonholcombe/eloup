'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Race = { id: string; label: string };

// Admin panel on a cup: add/remove races, edit the points scheme.
export function CupManage({
  slug,
  cupRaces,
  availableRaces,
  scheme,
}: {
  slug: string;
  cupRaces: Race[];
  availableRaces: Race[];
  scheme: number[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [schemeText, setSchemeText] = useState(scheme.join(', '));

  const post = (body: unknown) =>
    start(async () => {
      setErr(null);
      const resp = await fetch(`/api/racing/cups/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        setErr(await resp.text().catch(() => `error ${resp.status}`));
        return;
      }
      router.refresh();
    });

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Manage (admin)</p>

      <div>
        <p className="text-xs text-muted-foreground">Races in this cup</p>
        {cupRaces.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {cupRaces.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{r.label}</span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => post({ action: 'remove_race', raceId: r.id })}
                  className="h-tap px-2 text-xs text-red-300 shadow-none"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {availableRaces.length > 0 && (
        <div className="flex gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="h-tap flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
          >
            <option value="">— add a race —</option>
            {availableRaces.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            disabled={pending || !pick}
            onClick={() => pick && post({ action: 'add_race', raceId: pick })}
            className="h-tap shadow-none"
          >
            Add
          </Button>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = schemeText
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => !Number.isNaN(n));
          post({ action: 'set_scheme', pointsScheme: parsed });
        }}
      >
        <label className="flex-1 text-xs text-muted-foreground">
          Points by position
          <input
            value={schemeText}
            onChange={(e) => setSchemeText(e.target.value)}
            placeholder="10, 8, 6, 5, 4, 3, 2, 1"
            className="mt-1 h-tap w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={pending} className="mt-auto h-tap shadow-none">
          Save
        </Button>
      </form>

      {err && (
        <p role="alert" className="text-xs text-red-400">
          {err}
        </p>
      )}
    </div>
  );
}
