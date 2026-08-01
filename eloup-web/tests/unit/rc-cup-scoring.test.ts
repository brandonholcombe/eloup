import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POINTS_SCHEME,
  parsePointsScheme,
  pointsFor,
  scoreCup,
  type CupResultRow,
} from '@/lib/rc/cup';

const row = (
  driver_id: string,
  display_name: string,
  placement: number,
  player_id: string | null = null,
): CupResultRow => ({ driver_id, display_name, player_id, placement });

describe('pointsFor', () => {
  it('maps placement to scheme points, 0 beyond the scheme', () => {
    expect(pointsFor(DEFAULT_POINTS_SCHEME, 1)).toBe(10);
    expect(pointsFor(DEFAULT_POINTS_SCHEME, 8)).toBe(1);
    expect(pointsFor(DEFAULT_POINTS_SCHEME, 9)).toBe(0); // beyond cutoff
    expect(pointsFor(DEFAULT_POINTS_SCHEME, 0)).toBe(0);
  });
});

describe('scoreCup', () => {
  it('aggregates points across races and ranks by points', () => {
    // 2 races. Alice wins both, Bob 2nd both, Carol 3rd/DNF-ish.
    const rows = [
      row('a', 'Alice', 1),
      row('b', 'Bob', 2),
      row('c', 'Carol', 3),
      row('a', 'Alice', 1),
      row('b', 'Bob', 2),
      row('c', 'Carol', 9), // beyond cutoff -> 0 pts this race
    ];
    const s = scoreCup(rows, DEFAULT_POINTS_SCHEME);
    expect(s.map((x) => [x.displayName, x.points, x.wins, x.races])).toEqual([
      ['Alice', 20, 2, 2],
      ['Bob', 16, 0, 2],
      ['Carol', 6, 0, 2], // 6 (3rd) + 0 (9th)
    ]);
  });

  it('tiebreaks points → wins → best finish', () => {
    // Two drivers tie on points; the one with more wins ranks higher.
    const rows = [
      row('a', 'Ann', 1), // 10
      row('a', 'Ann', 4), // 5 -> 15, 1 win, best 1
      row('b', 'Bea', 2), // 8
      row('b', 'Bea', 3), // 6 -> 14
      row('c', 'Cid', 2), // 8
      row('c', 'Cid', 3), // 6 -> 14, best 2 same as Bea, but name tiebreak
    ];
    const s = scoreCup(rows, DEFAULT_POINTS_SCHEME);
    expect(s.map((x) => x.displayName)).toEqual(['Ann', 'Bea', 'Cid']);
    // Bea before Cid: equal points/wins/best -> name (Bea < Cid)
  });

  it('keys on driver_id so unlinked drivers still appear; keeps linked player', () => {
    const rows = [row('d1', 'Racer', 1, null), row('d2', 'Linked', 2, 'player_x')];
    const s = scoreCup(rows, DEFAULT_POINTS_SCHEME);
    expect(s.find((x) => x.driverId === 'd1')?.playerId).toBeNull();
    expect(s.find((x) => x.driverId === 'd2')?.playerId).toBe('player_x');
    expect(s).toHaveLength(2);
  });

  it('same display_name, different drivers stay separate (driver_id keyed)', () => {
    const rows = [row('d1', 'Sean', 1), row('d2', 'Sean', 2)];
    const s = scoreCup(rows, DEFAULT_POINTS_SCHEME);
    expect(s).toHaveLength(2);
  });
});

describe('parsePointsScheme', () => {
  it('accepts a non-empty array of non-negative ints (string or array)', () => {
    expect(parsePointsScheme('[10,8,6]')).toEqual([10, 8, 6]);
    expect(parsePointsScheme([5, 3, 1])).toEqual([5, 3, 1]);
  });
  it('rejects empty, non-int, or negative', () => {
    expect(() => parsePointsScheme('[]')).toThrow();
    expect(() => parsePointsScheme([1, -2])).toThrow();
    expect(() => parsePointsScheme([1, 2.5])).toThrow();
    expect(() => parsePointsScheme('not json')).toThrow();
  });
});
