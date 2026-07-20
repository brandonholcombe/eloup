import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { getRace, lapsForRace, listTracks, standingsForRace } from '@/lib/db/rc';
import { type LapChartDriver } from '@/components/LapChart';
import { RaceChartSection } from '@/components/RaceChartSection';
import { RaceAdminPanel } from '@/components/RaceAdminPanel';
import {
  CompareDriversSection,
  type CompareDriver,
} from '@/components/CompareDriversSection';
import { driverColor } from '@/lib/rc/colors';
import { formatRecordedDate } from '@/lib/rc/datetime';
import { formatLapMs } from '@/lib/rc/format';
import { DEFAULT_OUTLIER_MULTIPLIER, isLapOutlier } from '@/lib/rc/outliers';
import { rankingLapTimes } from '@/lib/rc/placement';
import { computeDriverStats, type DriverStats } from '@/lib/rc/stats';

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

  const session = await auth();
  const isAdmin = session?.user?.role === 'global_admin';

  const standings = standingsForRace(handle, race.id);
  const laps = lapsForRace(handle, race.id);
  const hasPenalty = standings.some((s) => s.penalty_ms > 0);
  const tracks = isAdmin ? listTracks(handle) : [];

  // Per-driver "ranking top-3 avg" for qualif/practice standings: this
  // is the value used by `comparePlacement` to order the standings — i.e.
  // the top-3-avg AFTER skipping the first `voided_laps_count` fastest
  // normal laps. Distinct from `computeDriverStats.top3AvgMs`, which is
  // void-blind (always raw). See h6-race-kind-ranking.md Phase H.
  const isRankingByTop3Avg =
    race.race_kind === 'qualif' || race.race_kind === 'practice';
  const rankingTop3AvgByDriver = new Map<string, number | null>();
  if (isRankingByTop3Avg) {
    const normalByDriver = new Map<string, number[]>();
    for (const l of laps) {
      if (l.lap_kind !== 'normal') continue;
      const arr = normalByDriver.get(l.driver_id) ?? [];
      arr.push(l.lap_time_ms);
      normalByDriver.set(l.driver_id, arr);
    }
    for (const s of standings) {
      const ascAll = (normalByDriver.get(s.driver_id) ?? []).slice().sort((a, b) => a - b);
      const ranking = rankingLapTimes(ascAll, s.voided_laps_count);
      if (ranking.length < 3) {
        rankingTop3AvgByDriver.set(s.driver_id, null);
      } else {
        rankingTop3AvgByDriver.set(
          s.driver_id,
          (ranking[0]! + ranking[1]! + ranking[2]!) / 3,
        );
      }
    }
  }

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

  // Compute per-driver stats ONCE and reuse for both the lap-by-lap
  // details and the compare section. Avoids double-computing the same
  // stats per driver and keeps the data shape explicit.
  const statsByDriver = new Map<string, DriverStats>();
  for (const s of standings) {
    const driverLaps = laps.filter((l) => l.driver_id === s.driver_id);
    statsByDriver.set(
      s.driver_id,
      computeDriverStats(
        driverLaps.map((l) => ({
          lapTimeMs: l.lap_time_ms,
          lapKind: l.lap_kind,
          lapNumber: l.lap_number ?? l.lap_index,
        })),
        s.best_lap_ms,
      ),
    );
  }

  const compareDrivers: CompareDriver[] = standings.map((s) => ({
    driverId: s.driver_id,
    displayName: s.display_name,
    stats: statsByDriver.get(s.driver_id)!,
  }));

  const chartSection = (
    <section>
      <RaceChartSection drivers={chartData} />
      <p className="mt-1 text-[11px] text-slate-500">
        Laps over {DEFAULT_OUTLIER_MULTIPLIER}× a driver&apos;s fastest are hidden from the chart
        as crashes / resets
        {outlierCount > 0 ? ` (${outlierCount} hidden)` : ''}. Tap a chip to toggle, long-press
        to isolate. Full lap-by-lap table is below.
      </p>
    </section>
  );

  const hasVoid = standings.some((s) => s.voided_laps_count > 0);

  const standingsSection = (
    <section>
      <h2 className="text-lg font-medium">Final standings</h2>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">Driver</th>
            <th className="py-2 pr-2 text-right">Laps</th>
            <th className="py-2 pr-2 text-right">Best</th>
            {isRankingByTop3Avg ? (
              <th className="py-2 pr-2 text-right">Top-3 avg</th>
            ) : (
              <th className="py-2 pr-2 text-right">Penalty</th>
            )}
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
                {isRankingByTop3Avg && s.voided_laps_count > 0 && (
                  <span className="ml-1 text-amber-400 text-[10px]">
                    -{s.voided_laps_count}
                  </span>
                )}
              </td>
              <td className="py-2 pr-2 text-right font-mono tabular-nums">
                {s.best_lap_ms != null ? formatLapMs(s.best_lap_ms) : '—'}
              </td>
              {isRankingByTop3Avg ? (
                <td className="py-2 pr-2 text-right font-mono tabular-nums">
                  {(() => {
                    const v = rankingTop3AvgByDriver.get(s.driver_id);
                    return v == null ? '—' : formatLapMs(v);
                  })()}
                </td>
              ) : (
                <td className="py-2 pr-2 text-right font-mono tabular-nums">
                  {s.penalty_ms > 0 ? (
                    <span className="text-amber-400">+{(s.penalty_ms / 1000).toFixed(1)}s</span>
                  ) : (
                    '—'
                  )}
                </td>
              )}
              <td className="py-2 pr-0 text-right font-mono tabular-nums">
                {formatLapMs(s.adjusted_total_time_ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasPenalty && !isRankingByTop3Avg && (
        <p className="mt-1 text-[11px] text-slate-500">Total includes penalty.</p>
      )}
      {isRankingByTop3Avg && hasVoid && (
        <p className="mt-1 text-[11px] text-slate-500">
          Voided laps skip the driver&apos;s N fastest from the top-3-avg ranking.
        </p>
      )}
    </section>
  );

  return (
    <main className="mx-auto max-w-4xl p-4">
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
        <time className="font-mono">{formatRecordedDate(race.race_started_at)}</time>
      </div>

      {/* lg: places chart 2/3 + standings 1/3 side-by-side. Below 1024px
          the grid collapses to a stack (mobile-first). The chart's SVG
          uses viewBox-based scaling so it renders cleanly at the
          narrower column width. */}
      <div className="mt-4 lg:grid lg:grid-cols-3 lg:gap-6">
        <div className="lg:col-span-2">{chartSection}</div>
        <div className="mt-6 lg:col-span-1 lg:mt-0">{standingsSection}</div>
      </div>

      {isAdmin && (
        <RaceAdminPanel
          raceId={race.id}
          currentTrackId={race.track_id}
          tracks={tracks.map((t) => ({ id: t.id, name: t.name }))}
          drivers={standings.map((s) => ({
            driverId: s.driver_id,
            displayName: s.display_name,
            penaltyMs: s.penalty_ms,
            voidedLapsCount: s.voided_laps_count,
          }))}
          raceName={race.race_name}
          raceKind={race.race_kind}
        />
      )}

      <CompareDriversSection drivers={compareDrivers} />

      <section className="mt-6 space-y-4">
        <h2 className="text-lg font-medium">Lap-by-lap</h2>
        {standings.map((s) => {
          const driverLaps = laps.filter((l) => l.driver_id === s.driver_id);
          const stats = statsByDriver.get(s.driver_id)!;
          return (
            <details key={s.driver_id} className="rounded-md border border-border bg-card">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: driverColor(s.driver_id) }}
                />
                <span className="font-medium">{s.display_name}</span>
                <span className="ml-auto text-xs text-slate-400">{driverLaps.length} entries</span>
              </summary>
              <DriverStatGrid stats={stats} />
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

function DriverStatGrid({ stats }: { stats: DriverStats }) {
  const items: Array<{ label: string; value: string; sub?: string }> = [
    { label: 'Best', value: optional(stats.bestMs) },
    {
      label: 'Average',
      value: optional(stats.avgMs),
      sub: stats.hiddenOutliers > 0 ? `${stats.hiddenOutliers} excl.` : undefined,
    },
    { label: 'Top 3 avg', value: optional(stats.top3AvgMs) },
    { label: 'Top 5 avg', value: optional(stats.top5AvgMs) },
    { label: 'Median', value: optional(stats.medianMs) },
    {
      label: 'Consistency',
      value: stats.consistencyMs == null ? '—' : `± ${formatLapMs(stats.consistencyMs)}`,
    },
    { label: 'First lap', value: optional(stats.firstLapMs) },
    { label: 'Counted', value: String(stats.countedLaps) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-1 border-t border-slate-800 bg-slate-950 p-2 text-xs sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded border border-border bg-card px-2 py-1.5"
        >
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums text-slate-100">
            <span>{it.value}</span>
            {it.sub && <span className="text-[9px] text-slate-500">{it.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function optional(ms: number | null): string {
  return ms == null ? '—' : formatLapMs(ms);
}
