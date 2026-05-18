import { afterAll, describe, expect, it } from 'vitest';
import { formatRecordedDate, formatRecordedDateOnly } from '@/lib/rc/datetime';

describe('formatRecordedDate', () => {
  it('renders an ISO with -07:00 offset in recorded local time (no zone shift)', () => {
    expect(formatRecordedDate('2026-05-03T09:51:32-07:00')).toBe('May 3, 2026, 9:51 AM');
  });

  it('renders an ISO with Z (UTC) in recorded local time verbatim', () => {
    expect(formatRecordedDate('2026-05-03T09:51:32Z')).toBe('May 3, 2026, 9:51 AM');
  });

  it('renders an ISO with +HH:MM offset in recorded local time verbatim', () => {
    expect(formatRecordedDate('2026-05-03T09:51:32+09:00')).toBe('May 3, 2026, 9:51 AM');
  });

  it('renders an offset-less ISO (TXT-imported) verbatim', () => {
    expect(formatRecordedDate('2026-05-03T09:51:32')).toBe('May 3, 2026, 9:51 AM');
  });

  it('formats midnight as 12:00 AM', () => {
    expect(formatRecordedDate('2026-05-03T00:00:00Z')).toBe('May 3, 2026, 12:00 AM');
  });

  it('formats noon as 12:00 PM', () => {
    expect(formatRecordedDate('2026-05-03T12:00:00Z')).toBe('May 3, 2026, 12:00 PM');
  });

  // Pins the full-month-name choice (NIT #8 in review). A future refactor
  // to short names (Jan/Feb/...) trips this test.
  it('uses full month names — non-May date proves it', () => {
    expect(formatRecordedDate('2026-01-15T08:30:00Z')).toBe('January 15, 2026, 8:30 AM');
  });

  it('returns input verbatim for unparseable strings', () => {
    expect(formatRecordedDate('garbage')).toBe('garbage');
    expect(formatRecordedDate('')).toBe('');
    expect(formatRecordedDate('2026-05-03')).toBe('2026-05-03'); // date-only not supported
  });

  it('returns input verbatim when month is out of range', () => {
    expect(formatRecordedDate('2026-13-03T09:51:32Z')).toBe('2026-13-03T09:51:32Z');
  });

  it('is independent of process.env.TZ — the regression anchor', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = formatRecordedDate('2026-05-03T09:51:32-07:00');
      process.env.TZ = 'America/Los_Angeles';
      const la = formatRecordedDate('2026-05-03T09:51:32-07:00');
      process.env.TZ = 'Asia/Tokyo';
      const jp = formatRecordedDate('2026-05-03T09:51:32-07:00');
      expect(utc).toBe('May 3, 2026, 9:51 AM');
      expect(la).toBe(utc);
      expect(jp).toBe(utc);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('formatRecordedDateOnly', () => {
  it('renders an ISO with offset as date-only verbatim', () => {
    expect(formatRecordedDateOnly('2026-05-03T09:51:32-07:00')).toBe('May 3, 2026');
  });

  it('renders an offset-less ISO as date-only', () => {
    expect(formatRecordedDateOnly('2026-05-17T14:54:26')).toBe('May 17, 2026');
  });

  it('uses full month names for non-May months', () => {
    expect(formatRecordedDateOnly('2026-09-01T12:00:00Z')).toBe('September 1, 2026');
  });

  it('returns input verbatim for unparseable strings', () => {
    expect(formatRecordedDateOnly('hi')).toBe('hi');
    expect(formatRecordedDateOnly('')).toBe('');
  });
});

afterAll(() => {
  // No global state to clean — the TZ test restores process.env.TZ inline.
});
