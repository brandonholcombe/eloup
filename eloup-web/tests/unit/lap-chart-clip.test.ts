import { describe, expect, it } from 'vitest';
import { lapChartClipMaxY } from '@/components/LapChart';

// Pins the 95th-percentile outlier clip choice from
// r1-rc-racing-dashboard.md §"Resolved review notes" #1.
describe('lapChartClipMaxY — 95th percentile clip', () => {
  it('clips a single 10× outlier in a 20-point series', () => {
    const data = [2000, 2100, 2200, 2050, 1950, 2150, 2080, 2030, 2010, 2120,
                  2090, 2070, 2110, 2030, 2040, 1980, 2020, 2060, 2100, 20000];
    expect(lapChartClipMaxY(data)).toBeLessThan(20000);
    expect(lapChartClipMaxY(data)).toBe(2200);
  });

  it('returns 0 for empty input', () => {
    expect(lapChartClipMaxY([])).toBe(0);
  });

  it('returns the single value for a 1-element series', () => {
    expect(lapChartClipMaxY([1500])).toBe(1500);
  });

  it('clips fixture-style data: Brandon final race lap 11 (11,374ms) is excluded', () => {
    const final = [5487, 1909, 1805, 1870, 2077, 1759, 2054, 6137, 1887, 4814, 11374];
    const clip = lapChartClipMaxY(final);
    expect(clip).toBeLessThan(11374);
    expect(clip).toBe(6137);
  });
});
