import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { bestLapsForTrack, getTrackBySlug } from '@/lib/db/rc';
import { driverColor } from '@/lib/rc/colors';
import { formatRecordedDateOnly } from '@/lib/rc/datetime';
import { formatLapMs } from '@/lib/rc/format';

export const dynamic = 'force-dynamic';

export default async function TrackLeaderboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const handle = db();
  const track = getTrackBySlug(handle, slug);
  if (!track) notFound();
  const bests = bestLapsForTrack(handle, track.id);

  return (
    <main className="mx-auto max-w-4xl p-4">
      <Link href="/racing" className="text-sm text-slate-400 hover:text-slate-200">
        ← All races
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{track.name}</h1>
      <p className="mt-1 text-sm text-slate-400">All-time best laps for this track.</p>
      {track.layout_notes && (
        <p className="mt-2 text-xs text-muted-foreground">{track.layout_notes}</p>
      )}

      {bests.length === 0 ? (
        <p className="mt-6 text-slate-400">No laps recorded yet on this track.</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {bests.map((b, i) => (
            <li
              key={b.driver_id}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              <span className="w-6 text-right font-mono text-muted-foreground">{i + 1}</span>
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: driverColor(b.driver_id) }}
              />
              <Link
                href={`/racing/drivers/${b.driver_id}`}
                className="flex-1 truncate text-slate-100 hover:text-white"
              >
                {b.display_name}
              </Link>
              <Link
                href={`/racing/${b.race_id}`}
                className="font-mono text-xs text-slate-400 hover:text-slate-200"
              >
                {b.race_name ?? formatRecordedDateOnly(b.race_started_at)}
              </Link>
              <span className="font-mono text-sm tabular-nums">{formatLapMs(b.lap_time_ms)}</span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
