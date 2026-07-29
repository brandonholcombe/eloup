import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getTrackBySlug, listRaces, listTracks } from '@/lib/db/rc';
import { canUploadRaceResults } from '@/lib/permissions';
import { formatRecordedDate } from '@/lib/rc/datetime';
import { TrackFilter } from '@/components/TrackFilter';

export const dynamic = 'force-dynamic';

type Search = { track?: string };

export default async function RacingIndexPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { track } = await searchParams;
  const session = await auth();
  const canUpload = canUploadRaceResults(
    session?.user ? { id: session.user.id, role: session.user.role } : null,
  );
  const handle = db();
  const tracks = listTracks(handle);
  const activeTrack = track ? getTrackBySlug(handle, track) : null;
  const activeSlug = activeTrack?.slug ?? null;
  const races = listRaces(handle, activeTrack ? { trackId: activeTrack.id } : {});

  return (
    <main className="mx-auto max-w-4xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Racing</h1>
          <p className="mt-1 text-sm text-slate-400">
            RC race results imported from Lap Monitor. Display-only — no ELO impact yet.
          </p>
        </div>
        {canUpload && (
          <Link
            href="/racing/upload"
            className="inline-flex items-center justify-center h-tap min-w-tap shrink-0 rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-400"
          >
            Upload
          </Link>
        )}
      </div>

      <div className="mt-4">
        <TrackFilter tracks={tracks} activeSlug={activeSlug} />
      </div>

      {races.length === 0 ? (
        <div className="mt-6 space-y-3">
          <p className="text-slate-400">
            {tracks.length === 0
              ? 'No races yet. An admin can upload a Lap Monitor JSON or TXT export to get started.'
              : 'No races for this track.'}
          </p>
          {canUpload && (
            <Link
              href="/racing/upload"
              className="inline-flex items-center justify-center h-tap min-w-tap rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400"
            >
              Upload Lap Monitor JSON or TXT
            </Link>
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {races.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-border bg-card px-3 py-3"
            >
              <Link href={`/racing/${r.id}`} className="block">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-100">
                    {r.race_name ?? r.race_kind}
                  </span>
                  <time className="font-mono text-xs text-slate-400">
                    {formatRecordedDate(r.race_started_at)}
                  </time>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
                  <span>{r.track_name}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="uppercase tracking-wide text-muted-foreground">{r.race_kind}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{r.driver_count} drivers</span>
                  {r.winner_display_name && (
                    <>
                      <span className="text-muted-foreground">·</span>
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
