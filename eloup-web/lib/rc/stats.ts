import { isLapOutlier } from '@/lib/rc/outliers';

export type StatLap = {
  lapTimeMs: number;
  lapKind: string;
  lapNumber: number | null;
};

export type DriverStats = {
  bestMs: number | null;
  avgMs: number | null;
  medianMs: number | null;
  top3AvgMs: number | null;
  top5AvgMs: number | null;
  // Population std dev of the same set used for `avgMs`. Smaller = more consistent.
  consistencyMs: number | null;
  firstLapMs: number | null;
  countedLaps: number;
  hiddenOutliers: number;
};

// Computes per-driver pace stats from a flat list of laps. Filters to
// `lap_kind === 'normal'` AND non-outlier (per `isLapOutlier`) before
// reducing. `bestLapMs` is the driver's true fastest lap from
// `rc_race_drivers.best_lap_ms` — used as the outlier reference.
//
// Pure function: no I/O, no globals. Returns `null` for stats that can't
// be computed (e.g., top3 with only 2 laps).
export function computeDriverStats(laps: StatLap[], bestLapMs: number | null): DriverStats {
  const normal = laps.filter((l) => l.lapKind === 'normal');
  const counted: number[] = [];
  let hiddenOutliers = 0;
  for (const l of normal) {
    if (isLapOutlier(l.lapTimeMs, bestLapMs)) {
      hiddenOutliers++;
      continue;
    }
    counted.push(l.lapTimeMs);
  }

  if (counted.length === 0) {
    return {
      bestMs: null,
      avgMs: null,
      medianMs: null,
      top3AvgMs: null,
      top5AvgMs: null,
      consistencyMs: null,
      firstLapMs: null,
      countedLaps: 0,
      hiddenOutliers,
    };
  }

  const sorted = [...counted].sort((a, b) => a - b);
  const sum = counted.reduce((a, b) => a + b, 0);
  const avg = sum / counted.length;
  const median = percentile(sorted, 0.5);
  const top3Avg = topNAvg(sorted, 3);
  const top5Avg = topNAvg(sorted, 5);
  const consistency = stddev(counted, avg);
  // First lap = the lap with the lowest `lapNumber` among counted laps;
  // null is treated as -Infinity-equivalent so it's never picked first
  // when a numbered lap is also present.
  const firstLap = pickFirstLap(normal.filter((l) => !isLapOutlier(l.lapTimeMs, bestLapMs)));

  return {
    bestMs: sorted[0]!,
    avgMs: avg,
    medianMs: median,
    top3AvgMs: top3Avg,
    top5AvgMs: top5Avg,
    consistencyMs: consistency,
    firstLapMs: firstLap,
    countedLaps: counted.length,
    hiddenOutliers,
  };
}

function topNAvg(sortedAsc: number[], n: number): number | null {
  if (sortedAsc.length < n) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += sortedAsc[i]!;
  return s / n;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.floor(sortedAsc.length * p);
  return sortedAsc[Math.min(idx, sortedAsc.length - 1)]!;
}

function stddev(values: number[], mean: number): number | null {
  if (values.length < 2) return null;
  let sumSq = 0;
  for (const v of values) sumSq += (v - mean) ** 2;
  return Math.sqrt(sumSq / values.length);
}

function pickFirstLap(laps: StatLap[]): number | null {
  let best: StatLap | null = null;
  for (const l of laps) {
    if (l.lapNumber == null) continue;
    if (best == null || (l.lapNumber as number) < (best.lapNumber as number)) best = l;
  }
  return best ? best.lapTimeMs : null;
}
