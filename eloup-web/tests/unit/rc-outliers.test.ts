import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTLIER_MULTIPLIER, isLapOutlier } from '@/lib/rc/outliers';

describe('isLapOutlier', () => {
  it('flags laps over 2× the driver best', () => {
    expect(isLapOutlier(40_000, 17_000)).toBe(true);
  });

  it('keeps laps at or below 2× the driver best', () => {
    // 2× exact match is NOT an outlier (must strictly exceed)
    expect(isLapOutlier(34_000, 17_000)).toBe(false);
    expect(isLapOutlier(30_000, 17_000)).toBe(false);
    expect(isLapOutlier(17_000, 17_000)).toBe(false);
  });

  it('returns false when driverBestLapMs is null or non-positive', () => {
    expect(isLapOutlier(40_000, null)).toBe(false);
    expect(isLapOutlier(40_000, 0)).toBe(false);
    expect(isLapOutlier(40_000, -1)).toBe(false);
  });

  it('respects a custom multiplier', () => {
    // Tighter cap: anything > 1.5× the best is an outlier. 17000 × 1.5 = 25500.
    expect(isLapOutlier(26_000, 17_000, 1.5)).toBe(true);
    expect(isLapOutlier(25_500, 17_000, 1.5)).toBe(false); // exact boundary, strict >
    expect(isLapOutlier(25_499, 17_000, 1.5)).toBe(false);
    expect(isLapOutlier(25_500, 17_000, 2.0)).toBe(false); // under 34000 threshold
  });

  it('reproduces the 123.9s prod outlier filter (>2× the 17.26s fastest)', () => {
    // The exact case from the first prod upload that motivated the filter.
    const prodFastest = 17_260;
    const prodOutlier = 123_900;
    expect(isLapOutlier(prodOutlier, prodFastest, DEFAULT_OUTLIER_MULTIPLIER)).toBe(true);
  });
});
