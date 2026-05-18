import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  driverWinLossStats,
  getDriverWithLinkedPlayer,
  perTrackBestsForDriver,
  recentRacesForDriver,
} from '@/lib/db/rc';
import { DriverPlayerLink } from '@/components/DriverPlayerLink';
import { driverColor } from '@/lib/rc/colors';
import { formatRecordedDateOnly } from '@/lib/rc/datetime';
import { formatLapMs } from '@/lib/rc/format';

export const dynamic = 'force-dynamic';

export default async function DriverProfilePage({
  params,
}: {
  params: Promise<{ driverId: string }>;
}) {
  const { driverId } = await params;
  const handle = db();
  const driver = getDriverWithLinkedPlayer(handle, driverId);
  if (!driver) notFound();
  const session = await auth();
  const isAdmin = session?.user?.role === 'global_admin';
  const recent = recentRacesForDriver(handle, driver.id);
  const bestsPerTrack = perTrackBestsForDriver(handle, driver.id);
  const winLoss = driverWinLossStats(handle, driver.id);

  const isLinked = driver.player_id != null && driver.linked_discord_handle != null;

  return (
    <main className="mx-auto max-w-4xl p-4">
      <Link href="/racing" className="text-sm text-slate-400 hover:text-slate-200">
        ← All races
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-4 w-4 rounded-full"
          style={{ background: driverColor(driver.id) }}
        />
        <h1 className="text-2xl font-semibold">{driver.display_name}</h1>
      </div>
      {isLinked ? (
        <p className="mt-1 text-sm text-slate-400">
          Linked to{' '}
          <Link href="/profile" className="text-blue-400 hover:text-blue-300">
            @{driver.linked_discord_handle}
          </Link>{' '}
          <span className="text-slate-500">({driver.linked_display_name})</span>
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-500">No Discord linkage — RC-local profile.</p>
      )}

      {isAdmin && (
        <DriverPlayerLink
          driverId={driver.id}
          currentLink={
            isLinked
              ? {
                  id: driver.player_id!,
                  display_name: driver.linked_display_name!,
                  discord_handle: driver.linked_discord_handle!,
                }
              : null
          }
        />
      )}

      <section className="mt-6">
        <h2 className="text-lg font-medium">Career stats</h2>
        <table className="mt-2 w-full border-separate border-spacing-y-1 text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-normal">Kind</th>
              <th className="text-right font-normal">Races</th>
              <th className="text-right font-normal">Wins</th>
              <th className="text-right font-normal">Podiums</th>
            </tr>
          </thead>
          <tbody>
            {winLoss.map((row) => (
              <tr key={row.raceKind}>
                <td className="rounded-l-md border-y border-l border-slate-800 bg-slate-900 px-2 py-1 text-slate-400">
                  {row.raceKind}
                </td>
                <td className="border-y border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono tabular-nums">
                  {row.totalRaces}
                </td>
                <td className="border-y border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono tabular-nums">
                  {row.wins}
                </td>
                <td className="rounded-r-md border-y border-r border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono tabular-nums">
                  {row.podiums}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-medium">Best lap per track</h2>
        {bestsPerTrack.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No normal laps recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {bestsPerTrack.map((b) => (
              <li
                key={b.track_id}
                className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              >
                <Link
                  href={`/racing/tracks/${encodeURIComponent(b.track_slug)}`}
                  className="hover:text-slate-100"
                >
                  {b.track_name}
                </Link>
                <span className="font-mono tabular-nums">{formatLapMs(b.best_lap_ms)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-medium">Recent races</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No races yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((r) => (
              <li
                key={r.race_id}
                className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              >
                <Link href={`/racing/${r.race_id}`} className="block">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{r.race_name ?? r.race_kind}</span>
                    <span className="font-mono text-xs text-slate-400">
                      #{r.placement} · {r.laps_completed} laps
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                    <span>{r.track_name}</span>
                    <span className="text-slate-600">·</span>
                    <time>{formatRecordedDateOnly(r.race_started_at)}</time>
                    {r.best_lap_ms != null && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono">best {formatLapMs(r.best_lap_ms)}</span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
