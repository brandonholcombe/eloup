import Link from 'next/link';
import { db } from '@/lib/db/client';
import { getTrackBySlug, listRaces, listTracks } from '@/lib/db/rc';
import { TrackFilter } from '@/components/TrackFilter';

export const dynamic = 'force-dynamic';

type Search = { track?: string };

export default async function RacingIndexPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { track } = await searchParams;
  const handle = db();
  const tracks = listTracks(handle);
  const activeTrack = track ? getTrackBySlug(handle, track) : null;
  const activeSlug = activeTrack?.slug ?? null;
  const races = listRaces(handle, activeTrack ? { trackId: activeTrack.id } : {});

  return (
    <main className="p-4">
      <h1 className="text-2xl font-semibold">Racing</h1>
      <p className="mt-1 text-sm text-slate-400">
        RC race results imported from Lap Monitor. Display-only — no ELO impact yet.
      </p>

      <div className="mt-4">
        <TrackFilter tracks={tracks} activeSlug={activeSlug} />
      </div>

      {races.length === 0 ? (
        <p className="mt-6 text-slate-400">
          {tracks.length === 0
            ? 'No races yet. An admin can upload a Lap Monitor JSON export to get started.'
            : 'No races for this track.'}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {races.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-slate-800 bg-slate-900 px-3 py-3"
            >
              <Link href={`/racing/${r.id}`} className="block">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-100">
                    {r.race_name ?? r.race_kind}
                  </span>
                  <time className="font-mono text-xs text-slate-400">
                    {formatDate(r.race_started_at)}
                  </time>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
                  <span>{r.track_name}</span>
                  <span className="text-slate-500">·</span>
                  <span className="uppercase tracking-wide text-slate-500">{r.race_kind}</span>
                  <span className="text-slate-500">·</span>
                  <span>{r.driver_count} drivers</span>
                  {r.winner_display_name && (
                    <>
                      <span className="text-slate-500">·</span>
                      <span className="text-emerald-400">🏁 {r.winner_display_name}</span>
                    </>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
