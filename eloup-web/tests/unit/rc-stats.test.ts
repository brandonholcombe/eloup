import { describe, expect, it } from 'vitest';
import { computeDriverStats, type StatLap } from '@/lib/rc/stats';

function L(ms: number, n: number | null = null, kind = 'normal'): StatLap {
  return { lapTimeMs: ms, lapKind: kind, lapNumber: n };
}

describe('computeDriverStats', () => {
  it('computes basic stats on a clean 5-lap series', () => {
    const laps = [L(17_000, 1), L(18_000, 2), L(19_000, 3), L(20_000, 4), L(21_000, 5)];
    const s = computeDriverStats(laps, 17_000);
    expect(s.bestMs).toBe(17_000);
    expect(s.avgMs).toBe(19_000);
    expect(s.medianMs).toBe(19_000);
    expect(s.top3AvgMs).toBe(18_000); // (17+18+19)/3
    expect(s.top5AvgMs).toBe(19_000); // all 5
    expect(s.countedLaps).toBe(5);
    expect(s.hiddenOutliers).toBe(0);
    expect(s.firstLapMs).toBe(17_000);
    expect(s.consistencyMs).toBeGreaterThan(0);
  });

  it('excludes outliers from all reductions but counts them', () => {
    const laps = [
      L(17_000, 1),
      L(18_000, 2),
      L(19_000, 3),
      L(50_000, 4), // > 2× 17000 → outlier
      L(20_000, 5),
    ];
    const s = computeDriverStats(laps, 17_000);
    expect(s.hiddenOutliers).toBe(1);
    expect(s.countedLaps).toBe(4);
    expect(s.bestMs).toBe(17_000);
    // avg = (17+18+19+20)/4 = 18.5k, NOT (17+18+19+50+20)/5 = 24.8k
    expect(s.avgMs).toBe(18_500);
  });

  it('skips lap_kind ignored laps from all stats', () => {
    const laps = [
      L(17_000, 1, 'normal'),
      L(18_000, null, 'ignored'),
      L(19_000, 2, 'normal'),
    ];
    const s = computeDriverStats(laps, 17_000);
    expect(s.countedLaps).toBe(2);
    expect(s.avgMs).toBe(18_000);
    expect(s.firstLapMs).toBe(17_000);
  });

  it('returns null top3 / top5 when not enough laps', () => {
    const laps = [L(17_000, 1), L(18_000, 2)];
    const s = computeDriverStats(laps, 17_000);
    expect(s.top3AvgMs).toBeNull();
    expect(s.top5AvgMs).toBeNull();
    expect(s.bestMs).toBe(17_000);
  });

  it('returns all-null when every lap is an outlier or filtered', () => {
    const laps = [L(40_000, 1), L(45_000, 2)];
    const s = computeDriverStats(laps, 17_000);
    expect(s.bestMs).toBeNull();
    expect(s.avgMs).toBeNull();
    expect(s.medianMs).toBeNull();
    expect(s.consistencyMs).toBeNull();
    expect(s.firstLapMs).toBeNull();
    expect(s.countedLaps).toBe(0);
    expect(s.hiddenOutliers).toBe(2);
  });

  it('consistencyMs is null with a single lap (no variance possible)', () => {
    const s = computeDriverStats([L(17_000, 1)], 17_000);
    expect(s.consistencyMs).toBeNull();
  });

  it('first lap is the lowest lap_number, not the first array element', () => {
    const laps = [L(19_000, 3), L(17_000, 1), L(18_000, 2)];
    const s = computeDriverStats(laps, 17_000);
    expect(s.firstLapMs).toBe(17_000); // lap_number=1
  });

  it('handles a 3-lap series for top3 = whole-series avg', () => {
    const laps = [L(17_000, 1), L(18_000, 2), L(19_000, 3)];
    const s = computeDriverStats(laps, 17_000);
    expect(s.top3AvgMs).toBe(18_000);
    expect(s.top5AvgMs).toBeNull();
  });

  it('top3 uses the 3 FASTEST laps, not the first 3 in the array', () => {
    const laps = [L(25_000, 1), L(26_000, 2), L(17_000, 3), L(18_000, 4), L(19_000, 5)];
    const s = computeDriverStats(laps, 17_000);
    expect(s.top3AvgMs).toBe(18_000); // (17+18+19)/3
  });
});
