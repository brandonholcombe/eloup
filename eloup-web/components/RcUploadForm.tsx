'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { RcTrackRow } from '@/lib/db/rc';

type Mode = 'existing' | 'new';

export function RcUploadForm({ tracks }: { tracks: RcTrackRow[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(tracks.length > 0 ? 'existing' : 'new');
  const [trackId, setTrackId] = useState<string>(tracks[0]?.id ?? '');
  const [newTrackName, setNewTrackName] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        setOk(null);
        // Client-side format sniff: first non-blank char `{` → JSON,
        // anything else → TXT. The server requires an explicit `format`
        // literal — no server-side sniffing.
        const firstNonBlank = text.replace(/^\s+/, '').charAt(0);
        const isJson = firstNonBlank === '{';
        let jsonParsed: unknown;
        if (isJson) {
          try {
            jsonParsed = JSON.parse(text);
          } catch (parseErr) {
            setErr(`JSON parse error: ${(parseErr as Error).message}`);
            return;
          }
        }
        start(async () => {
          const trackPart =
            mode === 'existing'
              ? { trackId }
              : { newTrackName: newTrackName.trim() };
          const body = isJson
            ? { format: 'json' as const, ...trackPart, json: jsonParsed }
            : { format: 'txt' as const, ...trackPart, text };
          const resp = await fetch('/api/racing/import', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = (await resp.json().catch(() => ({}))) as {
            error?: string;
            reason?: string;
            summary?: {
              totalRaces: number;
              insertedRaces: number;
              duplicateRaces: number;
              driversCreated: number;
              driversReused: number;
              lapsImported: number;
            };
          };
          if (!resp.ok) {
            setErr(`${data.error ?? `error ${resp.status}`}${data.reason ? `: ${data.reason}` : ''}`);
            return;
          }
          const s = data.summary!;
          setOk(
            `Imported ${s.insertedRaces}/${s.totalRaces} races (${s.duplicateRaces} duplicates); ` +
              `${s.driversCreated} new drivers, ${s.driversReused} reused; ${s.lapsImported} laps.`,
          );
          setText('');
          router.refresh();
        });
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wide text-slate-400">Track</legend>
        {tracks.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="radio"
              name="track-mode"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
            />
            Existing track
          </label>
        )}
        {mode === 'existing' && tracks.length > 0 && (
          <select
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            className="block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="radio"
            name="track-mode"
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />
          New track
        </label>
        {mode === 'new' && (
          <input
            required
            value={newTrackName}
            onChange={(e) => setNewTrackName(e.target.value)}
            placeholder="Track name (e.g. Outdoor Long)"
            className="block w-full h-tap rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
          />
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wide text-slate-400">
          Lap Monitor JSON or TXT
        </legend>
        <input
          type="file"
          accept=".json,.txt,application/json,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setText(await file.text());
          }}
          className="block w-full text-sm text-slate-300"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "races": [...] }  or  Race    May 17, 2026 at ...'
          rows={6}
          className="block w-full rounded-md border border-slate-700 bg-slate-900 p-2 font-mono text-xs"
        />
      </fieldset>

      <button
        type="submit"
        disabled={pending || !text.trim() || (mode === 'new' && !newTrackName.trim())}
        className="h-tap min-w-tap w-full rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Importing…' : 'Import'}
      </button>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {ok && <p className="text-sm text-emerald-400">{ok}</p>}
    </form>
  );
}
