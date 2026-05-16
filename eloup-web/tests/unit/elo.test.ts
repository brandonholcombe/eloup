import { describe, expect, it } from 'vitest';
import { computeMatchDeltas, type Outcome, type Participant } from '@/lib/elo';

describe('computeMatchDeltas — 1v1', () => {
  it('symmetric: equal ratings, winner gains +K/2, loser loses -K/2', () => {
    const p: Participant[] = [
      { playerId: 'a', ratingBefore: 1200 },
      { playerId: 'b', ratingBefore: 1200 },
    ];
    const o: Outcome[] = [
      { playerId: 'a', placement: 1 },
      { playerId: 'b', placement: 2 },
    ];
    const d = computeMatchDeltas(p, o, '1v1', 32);
    expect(d.get('a')).toBeCloseTo(16, 5);
    expect(d.get('b')).toBeCloseTo(-16, 5);
    expect(d.get('a')! + d.get('b')!).toBeCloseTo(0, 5);
  });

  it('upset: low-rated player beats high-rated player gets large delta', () => {
    const p: Participant[] = [
      { playerId: 'high', ratingBefore: 1600 },
      { playerId: 'low', ratingBefore: 1200 },
    ];
    const o: Outcome[] = [
      { playerId: 'low', placement: 1 },
      { playerId: 'high', placement: 2 },
    ];
    const d = computeMatchDeltas(p, o, '1v1', 32);
    expect(d.get('low')).toBeGreaterThan(24);
    expect(d.get('high')).toBeLessThan(-24);
    expect(d.get('low')! + d.get('high')!).toBeCloseTo(0, 5);
  });

  it('tie: both players get K * (0.5 - expected)', () => {
    const p: Participant[] = [
      { playerId: 'a', ratingBefore: 1400 },
      { playerId: 'b', ratingBefore: 1200 },
    ];
    const o: Outcome[] = [
      { playerId: 'a', placement: 1 },
      { playerId: 'b', placement: 1 },
    ];
    const d = computeMatchDeltas(p, o, '1v1', 32);
    // a is expected to beat b ~0.76; tie → a loses some, b gains some
    expect(d.get('a')).toBeLessThan(0);
    expect(d.get('b')).toBeGreaterThan(0);
    expect(d.get('a')! + d.get('b')!).toBeCloseTo(0, 5);
  });

  it('throws if participant count is not 2', () => {
    expect(() =>
      computeMatchDeltas(
        [{ playerId: 'a', ratingBefore: 1200 }],
        [{ playerId: 'a', placement: 1 }],
        '1v1',
        32,
      ),
    ).toThrow();
  });
});

describe('computeMatchDeltas — team (Q-RATE-2 default a: team-average, equal delta)', () => {
  it('2v2 with equal team averages → tie expectation, winning team all get +d', () => {
    const p: Participant[] = [
      { playerId: 'a1', ratingBefore: 1200, teamLabel: 'A' },
      { playerId: 'a2', ratingBefore: 1300, teamLabel: 'A' },
      { playerId: 'b1', ratingBefore: 1100, teamLabel: 'B' },
      { playerId: 'b2', ratingBefore: 1400, teamLabel: 'B' },
    ];
    const o: Outcome[] = [
      { playerId: 'a1', placement: 1 },
      { playerId: 'a2', placement: 1 },
      { playerId: 'b1', placement: 2 },
      { playerId: 'b2', placement: 2 },
    ];
    const d = computeMatchDeltas(p, o, 'team', 32);
    // Both averages = 1250 → expected 0.5 each → winner gains +16 each
    expect(d.get('a1')).toBeCloseTo(16, 5);
    expect(d.get('a2')).toBeCloseTo(16, 5);
    expect(d.get('b1')).toBeCloseTo(-16, 5);
    expect(d.get('b2')).toBeCloseTo(-16, 5);
  });

  it('throws when not exactly 2 teams', () => {
    const p: Participant[] = [
      { playerId: 'a', ratingBefore: 1200, teamLabel: 'A' },
      { playerId: 'b', ratingBefore: 1200, teamLabel: 'B' },
      { playerId: 'c', ratingBefore: 1200, teamLabel: 'C' },
    ];
    const o: Outcome[] = [
      { playerId: 'a', placement: 1 },
      { playerId: 'b', placement: 2 },
      { playerId: 'c', placement: 3 },
    ];
    expect(() => computeMatchDeltas(p, o, 'team', 32)).toThrow();
  });
});

describe('computeMatchDeltas — FFA (Q-RATE-3: pairwise with K/(n-1))', () => {
  it('4-player FFA with equal ratings: winner gains, loser loses, sum is 0', () => {
    const p: Participant[] = [
      { playerId: '1st', ratingBefore: 1200 },
      { playerId: '2nd', ratingBefore: 1200 },
      { playerId: '3rd', ratingBefore: 1200 },
      { playerId: '4th', ratingBefore: 1200 },
    ];
    const o: Outcome[] = [
      { playerId: '1st', placement: 1 },
      { playerId: '2nd', placement: 2 },
      { playerId: '3rd', placement: 3 },
      { playerId: '4th', placement: 4 },
    ];
    const d = computeMatchDeltas(p, o, 'ffa', 32);
    // K_adj = 32/3 ≈ 10.67. 1st beats 3 → +3 * 10.67 * 0.5 = 16. 4th loses 3 → -16.
    expect(d.get('1st')).toBeCloseTo(16, 5);
    expect(d.get('4th')).toBeCloseTo(-16, 5);
    expect(d.get('2nd')! + d.get('3rd')!).toBeCloseTo(0, 5);
    const sum = [...d.values()].reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(0, 5);
  });

  it('throws with fewer than 2 participants', () => {
    expect(() =>
      computeMatchDeltas(
        [{ playerId: 'a', ratingBefore: 1200 }],
        [{ playerId: 'a', placement: 1 }],
        'ffa',
        32,
      ),
    ).toThrow();
  });
});

describe('computeMatchDeltas — outcome lookup', () => {
  it('throws if outcome missing for a participant', () => {
    const p: Participant[] = [
      { playerId: 'a', ratingBefore: 1200 },
      { playerId: 'b', ratingBefore: 1200 },
    ];
    const o: Outcome[] = [{ playerId: 'a', placement: 1 }];
    expect(() => computeMatchDeltas(p, o, '1v1', 32)).toThrow();
  });
});
