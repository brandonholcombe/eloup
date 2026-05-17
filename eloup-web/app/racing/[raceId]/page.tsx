import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { getRace, lapsForRace, standingsForRace } from '@/lib/db/rc';
import { LapChart, type LapChartDriver } from '@/components/LapChart';
import { driverColor } from '@/lib/rc/colors';
import { formatLapMs } from '@/lib/rc/format';
import { DEFAULT_OUTLIER_MULTIPLIER, isLapOutlier } from '@/lib/rc/outliers';

export const dynamic = 'force-dynamic';

export default async function RaceDetailPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const handle = db();
  const race = getRace(handle, raceId);
  if (!race) notFound();

  const standings = standingsForRace(handle, race.id);
  const laps = lapsForRace(handle, race.id);

  const bestByDriver = new Map(standings.map((s) => [s.driver_id, s.best_lap_ms]));
  let outlierCount = 0;
  const chartData: LapChartDriver[] = standings.map((s) => {
    const best = bestByDriver.get(s.driver_id) ?? null;
    return {
      driverId: s.driver_id,
      displayName: s.display_name,
      laps: laps
        .filter((l) => l.driver_id === s.driver_id && l.lap_kind === 'normal')
        .filter((l) => {
          if (isLapOutlier(l.lap_time_ms, best)) {
            outlierCount++;
            return false;
          }
          return true;
        })
        .map((l) => ({ lapNumber: l.lap_number ?? l.lap_index, lapTimeMs: l.lap_time_ms })),
    };
  });

  return (
    <main className="p-4">
      <Link href="/racing" className="text-sm text-slate-400 hover:text-slate-200">
        ← All races
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{race.race_name ?? race.race_kind}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
        <Link
          href={`/racing/tracks/${encodeURIComponent(race.track_slug)}`}
          className="hover:text-slate-100"
        >
          {race.track_name}
        </Link>
        <span className="text-slate-500">·</span>
        <span className="uppercase tracking-wide text-slate-500">{race.race_kind}</span>
        <span className="text-slate-500">·</span>
        <time className="font-mono">{formatDateTime(race.race_started_at)}</time>
      </div>

      <section className="mt-4">
        <LapChart drivers={chartData} />
        <p className="mt-1 text-[11px] text-slate-500">
          Laps over {DEFAULT_OUTLIER_MULTIPLIER}× a driver&apos;s fastest are hidden from the chart
          as crashes / resets
          {outlierCount > 0 ? ` (${outlierCount} hidden)` : ''}. Full lap-by-lap table is below.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-medium">Final standings</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Driver</th>
              <th className="py-2 pr-2 text-right">Laps</th>
              <th className="py-2 pr-2 text-right">Best</th>
              <th className="py-2 pr-0 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => (
              <tr key={s.driver_id} className="border-t border-slate-800">
                <td className="py-2 pr-2 font-mono">{s.placement}</td>
                <td className="py-2 pr-2">
                  <Link
                    href={`/racing/drivers/${s.driver_id}`}
                    className="flex items-center gap-2 hover:text-slate-100"
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: driverColor(s.driver_id) }}
                    />
                    {s.display_name}
                  </Link>
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums">
                  {s.laps_completed}
                </td>
                <td className="py-2 pr-2 text-right font-mono tabular-nums">
                  {s.best_lap_ms != null ? formatLapMs(s.best_lap_ms) : '—'}
                </td>
                <td className="py-2 pr-0 text-right font-mono tabular-nums">
                  {formatLapMs(s.total_time_ms)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 space-y-4">
        <h2 className="text-lg font-medium">Lap-by-lap</h2>
        {standings.map((s) => {
          const driverLaps = laps.filter((l) => l.driver_id === s.driver_id);
          return (
            <details key={s.driver_id} className="rounded-md border border-slate-800 bg-slate-900">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: driverColor(s.driver_id) }}
                />
                <span className="font-medium">{s.display_name}</span>
                <span className="ml-auto text-xs text-slate-400">{driverLaps.length} entries</span>
              </summary>
              <table className="w-full border-t border-slate-800 text-xs">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="px-3 py-1 font-normal">#</th>
                    <th className="px-3 py-1 font-normal">Kind</th>
                    <th className="px-3 py-1 text-right font-normal">Lap time</th>
                    <th className="px-3 py-1 text-right font-normal">Elapsed</th>
                  </tr>
                </thead>
                <tbody>
                  {driverLaps.map((l) => {
                    const isOutlier =
                      l.lap_kind === 'normal' && isLapOutlier(l.lap_time_ms, s.best_lap_ms);
                    const faded = l.lap_kind === 'ignored' || isOutlier;
                    return (
                      <tr
                        key={l.lap_index}
                        className={'border-t border-slate-800 ' + (faded ? 'text-slate-500' : '')}
                      >
                        <td className="px-3 py-1 font-mono">
                          {l.lap_kind === 'normal' ? l.lap_number : '—'}
                        </td>
                        <td className="px-3 py-1">
                          {l.lap_kind}
                          {isOutlier && (
                            <span
                              className="ml-1 text-amber-500"
                              title={`> ${DEFAULT_OUTLIER_MULTIPLIER}× fastest — hidden from chart`}
                            >
                              ⚑ outlier
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums">
                          {formatLapMs(l.lap_time_ms)}
                        </td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums">
                          {formatLapMs(l.end_timestamp_ms)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          );
        })}
      </section>
    </main>
  );
}

function formatDateTime(iso: string): string {
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
