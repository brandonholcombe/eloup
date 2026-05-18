'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

const NEW_TRACK_SENTINEL = '__new__';

type TrackOption = { id: string; name: string };

export type RaceAdminPanelDriver = {
  driverId: string;
  displayName: string;
  penaltyMs: number;
};

export function RaceAdminPanel({
  raceId,
  currentTrackId,
  tracks,
  drivers,
}: {
  raceId: string;
  currentTrackId: string;
  tracks: TrackOption[];
  drivers: RaceAdminPanelDriver[];
}) {
  return (
    <section className="mt-6 rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h2 className="text-lg font-medium">Admin</h2>
      <p className="text-xs text-slate-400">Global admins can re-assign the track and apply penalties.</p>
      <TrackChangeForm raceId={raceId} currentTrackId={currentTrackId} tracks={tracks} />
      <PenaltyTable raceId={raceId} drivers={drivers} />
    </section>
  );
}

function TrackChangeForm({
  raceId,
  currentTrackId,
  tracks,
}: {
  raceId: string;
  currentTrackId: string;
  tracks: TrackOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(currentTrackId);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const isNew = selected === NEW_TRACK_SENTINEL;

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        setOk(null);
        start(async () => {
          const body = isNew
            ? { trackName: newName.trim() }
            : { trackId: selected };
          const resp = await fetch(`/api/racing/races/${raceId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = (await resp.json().catch(() => ({}))) as {
            error?: string;
            matched?: boolean;
          };
          if (!resp.ok) {
            setErr(data.error ?? `error ${resp.status}`);
            return;
          }
          setOk(data.matched ? 'Reused existing track (name match)' : 'Track updated');
          setNewName('');
          router.refresh();
        });
      }}
    >
      <label className="block text-xs uppercase tracking-wide text-slate-400">Track</label>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
      >
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        <option value={NEW_TRACK_SENTINEL}>New track…</option>
      </select>
      {isNew && (
        <input
          required
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={120}
          placeholder="Track name (e.g. Outdoor Long)"
          className="block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
        />
      )}
      <button
        type="submit"
        disabled={pending || (isNew && !newName.trim()) || (!isNew && selected === currentTrackId)}
        className="h-tap min-w-tap rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save track'}
      </button>
      {err && <p className="text-sm text-red-400">{err}</p>}
      {ok && <p className="text-sm text-emerald-400">{ok}</p>}
    </form>
  );
}

function PenaltyTable({
  raceId,
  drivers,
}: {
  raceId: string;
  drivers: RaceAdminPanelDriver[];
}) {
  return (
    <div className="mt-4">
      <h3 className="text-xs uppercase tracking-wide text-slate-400">Penalties</h3>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-1 pr-2">Driver</th>
            <th className="py-1 pr-2 text-right">Penalty (s)</th>
            <th className="py-1 pr-0 text-right" />
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => (
            <PenaltyRow key={d.driverId} raceId={raceId} driver={d} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PenaltyRow({
  raceId,
  driver,
}: {
  raceId: string;
  driver: RaceAdminPanelDriver;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>((driver.penaltyMs / 1000).toFixed(1));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <tr className="border-t border-slate-800">
      <td className="py-2 pr-2">{driver.displayName}</td>
      <td className="py-2 pr-2 text-right">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          max="599.999"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-tap w-24 rounded-md border border-slate-700 bg-slate-900 px-2 text-right font-mono text-sm tabular-nums"
        />
      </td>
      <td className="py-2 pr-0 text-right">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setErr(null);
            const seconds = Number(value);
            if (!Number.isFinite(seconds) || seconds < 0) {
              setErr('Enter a non-negative number');
              return;
            }
            const penaltyMs = Math.round(seconds * 1000);
            if (penaltyMs >= 600_000) {
              setErr('Must be < 600s');
              return;
            }
            start(async () => {
              const resp = await fetch(
                `/api/racing/races/${raceId}/drivers/${driver.driverId}`,
                {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ penalty_ms: penaltyMs }),
                },
              );
              if (!resp.ok) {
                const body = (await resp.json().catch(() => ({}))) as { error?: string };
                setErr(body.error ?? `error ${resp.status}`);
                return;
              }
              router.refresh();
            });
          }}
          className="h-tap min-w-tap rounded-md bg-blue-500 px-3 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
      </td>
    </tr>
  );
}
