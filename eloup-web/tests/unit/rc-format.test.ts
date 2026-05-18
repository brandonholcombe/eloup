import { describe, expect, it } from 'vitest';
import { formatLapMs } from '@/lib/rc/format';
import { driverColor } from '@/lib/rc/colors';

describe('formatLapMs', () => {
  it('formats sub-second values at centisecond precision', () => {
    expect(formatLapMs(2171)).toBe('00:02.17');
  });
  it('formats round seconds', () => {
    expect(formatLapMs(60_000)).toBe('01:00.00');
  });
  it('formats large minute values', () => {
    expect(formatLapMs(125_678)).toBe('02:05.67');
  });
  it('treats 0 and negatives as 00:00.00', () => {
    expect(formatLapMs(0)).toBe('00:00.00');
    expect(formatLapMs(-500)).toBe('00:00.00');
    expect(formatLapMs(Number.NaN)).toBe('00:00.00');
  });
  it('Lap Monitor magnitudes — Sean lap 1 = 15230ms → 00:15.23', () => {
    // Pin the case the prior centisecond-vs-millisecond fix surfaced.
    expect(formatLapMs(15_230)).toBe('00:15.23');
    expect(formatLapMs(310_700)).toBe('05:10.70');
  });
});

describe('driverColor', () => {
  it('is deterministic for the same id', () => {
    expect(driverColor('abc')).toBe(driverColor('abc'));
  });
  it('typically differs for different ids', () => {
    const a = driverColor('F8CFF97C-71B0-4FDA-B054-E820F4B774EF');
    const b = driverColor('D0C3A00B-4E2C-4018-9B3E-4661C02008FA');
    expect(a).not.toBe(b);
  });
  it('returns an HSL string', () => {
    expect(driverColor('abc')).toMatch(/^hsl\(\d+ 70% 55%\)$/);
  });
});
