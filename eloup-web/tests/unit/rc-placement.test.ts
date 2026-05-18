import { describe, expect, it } from 'vitest';
import {
  comparePlacement,
  rankingLapTimes,
  type PlacementInput,
  type RaceKind,
} from '@/lib/rc/placement';

function input(overrides: Partial<PlacementInput> = {}): PlacementInput {
  return {
    driverId: 'd',
    lapsCompleted: 10,
    bestLapMs: 20_000,
    totalTimeMs: 200_000,
    penaltyMs: 0,
    rankingLapsAscMs: [20_000, 21_000, 22_000, 23_000, 24_000],
    transponderId: 1,
    ...overrides,
  };
}

function sortBy(inputs: PlacementInput[], kind: RaceKind): PlacementInput[] {
  return [...inputs].sort((a, b) => comparePlacement(a, b, kind));
}

describe('rankingLapTimes', () => {
  it('returns input unchanged when voidedLapsCount is 0', () => {
    const asc = [18_000, 19_000, 20_000];
    expect(rankingLapTimes(asc, 0)).toEqual(asc);
  });

  it('returns input unchanged when voidedLapsCount is negative', () => {
    const asc = [18_000, 19_000, 20_000];
    expect(rankingLapTimes(asc, -1)).toEqual(asc);
  });

  it('drops the first fastest entry when voidedLapsCount is 1', () => {
    expect(rankingLapTimes([18_000, 19_000, 20_000], 1)).toEqual([19_000, 20_000]);
  });

  it('returns [] when voidedLapsCount >= length', () => {
    expect(rankingLapTimes([18_000, 19_000], 2)).toEqual([]);
    expect(rankingLapTimes([18_000, 19_000], 5)).toEqual([]);
  });
});

describe('comparePlacement — race kind', () => {
  it('higher laps_completed wins regardless of times', () => {
    const a = input({ driverId: 'a', lapsCompleted: 20, totalTimeMs: 200_000 });
    const b = input({ driverId: 'b', lapsCompleted: 19, totalTimeMs: 100_000 });
    expect(sortBy([b, a], 'race').map((p) => p.driverId)).toEqual(['a', 'b']);
  });

  it('ties on laps → adjusted total (total + penalty) ASC', () => {
    const a = input({
      driverId: 'a',
      lapsCompleted: 10,
      totalTimeMs: 200_000,
      penaltyMs: 5000,
    }); // adj = 205000
    const b = input({
      driverId: 'b',
      lapsCompleted: 10,
      totalTimeMs: 201_000,
      penaltyMs: 0,
    }); // adj = 201000
    expect(sortBy([a, b], 'race').map((p) => p.driverId)).toEqual(['b', 'a']);
  });

  it('ties on laps + adjusted total → transponder ASC', () => {
    const a = input({
      driverId: 'a',
      lapsCompleted: 10,
      totalTimeMs: 200_000,
      transponderId: 30,
    });
    const b = input({
      driverId: 'b',
      lapsCompleted: 10,
      totalTimeMs: 200_000,
      transponderId: 10,
    });
    expect(sortBy([a, b], 'race').map((p) => p.driverId)).toEqual(['b', 'a']);
  });
});

describe('comparePlacement — qualif/practice kind', () => {
  it('lower top-3-avg wins', () => {
    const a = input({
      driverId: 'a',
      rankingLapsAscMs: [20_000, 21_000, 22_000, 30_000],
    }); // avg 21000
    const b = input({
      driverId: 'b',
      rankingLapsAscMs: [19_000, 19_500, 20_500, 30_000],
    }); // avg 19666
    expect(sortBy([a, b], 'qualif').map((p) => p.driverId)).toEqual(['b', 'a']);
  });

  it('ties on top-3-avg → best-lap ASC', () => {
    // Same top-3 sum, distinct bestLapMs.
    const a = input({
      driverId: 'a',
      rankingLapsAscMs: [20_000, 21_000, 22_000],
      bestLapMs: 20_000,
    });
    const b = input({
      driverId: 'b',
      rankingLapsAscMs: [20_000, 21_000, 22_000],
      bestLapMs: 19_500,
    });
    expect(sortBy([a, b], 'qualif').map((p) => p.driverId)).toEqual(['b', 'a']);
  });

  it('ties on top-3-avg + best-lap → laps_completed DESC', () => {
    const a = input({
      driverId: 'a',
      rankingLapsAscMs: [20_000, 21_000, 22_000],
      bestLapMs: 20_000,
      lapsCompleted: 10,
    });
    const b = input({
      driverId: 'b',
      rankingLapsAscMs: [20_000, 21_000, 22_000],
      bestLapMs: 20_000,
      lapsCompleted: 15,
    });
    expect(sortBy([a, b], 'qualif').map((p) => p.driverId)).toEqual(['b', 'a']);
  });

  it('3-lap driver beats 2-lap driver regardless of times', () => {
    const fast2 = input({
      driverId: 'fast2',
      rankingLapsAscMs: [10_000, 10_500],
      bestLapMs: 10_000,
    });
    const slow3 = input({
      driverId: 'slow3',
      rankingLapsAscMs: [30_000, 31_000, 32_000],
      bestLapMs: 30_000,
    });
    expect(sortBy([fast2, slow3], 'qualif').map((p) => p.driverId)).toEqual([
      'slow3',
      'fast2',
    ]);
  });

  it('both <3 laps: best-lap ASC, null = last', () => {
    const a = input({
      driverId: 'a',
      rankingLapsAscMs: [20_000, 21_000],
      bestLapMs: 20_000,
    });
    const b = input({
      driverId: 'b',
      rankingLapsAscMs: [19_000, 19_500],
      bestLapMs: 19_000,
    });
    const c = input({ driverId: 'c', rankingLapsAscMs: [], bestLapMs: null });
    expect(sortBy([c, a, b], 'qualif').map((p) => p.driverId)).toEqual(['b', 'a', 'c']);
  });

  it('both <3 laps + tied best-lap → transponder ASC', () => {
    const a = input({
      driverId: 'a',
      rankingLapsAscMs: [20_000, 21_000],
      bestLapMs: 20_000,
      transponderId: 30,
    });
    const b = input({
      driverId: 'b',
      rankingLapsAscMs: [20_000, 21_000],
      bestLapMs: 20_000,
      transponderId: 10,
    });
    expect(sortBy([a, b], 'qualif').map((p) => p.driverId)).toEqual(['b', 'a']);
  });

  it('voiding the fastest lap can flip the ranking', () => {
    // Driver A has fastest single lap but slower 2nd and 3rd. Driver B has
    // more consistent 1-3 laps. Without void: A wins on avg. After A
    // voids 1 lap (their fastest): A's ranking laps are [21k, 22k, 30k]
    // (avg ~24333), B's stay [20k, 20.5k, 21k] (avg ~20500) → B wins.
    const aRaw = [10_000, 21_000, 22_000, 30_000]; // raw avg of top3 ~17666
    const bRaw = [20_000, 20_500, 21_000, 30_000]; // top3 avg 20500

    const aRaw3 = (10_000 + 21_000 + 22_000) / 3;
    const bRaw3 = (20_000 + 20_500 + 21_000) / 3;
    expect(aRaw3).toBeLessThan(bRaw3); // sanity: A faster pre-void

    const a = input({
      driverId: 'a',
      rankingLapsAscMs: rankingLapTimes(aRaw, 0),
      bestLapMs: 10_000,
    });
    const b = input({
      driverId: 'b',
      rankingLapsAscMs: rankingLapTimes(bRaw, 0),
      bestLapMs: 20_000,
    });
    expect(sortBy([a, b], 'qualif').map((p) => p.driverId)).toEqual(['a', 'b']);

    // Now void 1 lap from A — flip.
    const aVoid = input({
      driverId: 'a',
      rankingLapsAscMs: rankingLapTimes(aRaw, 1),
      bestLapMs: 10_000,
    });
    expect(sortBy([aVoid, b], 'qualif').map((p) => p.driverId)).toEqual(['b', 'a']);
  });

  it('practice kind: same shape as qualif', () => {
    const a = input({
      driverId: 'a',
      rankingLapsAscMs: [20_000, 21_000, 22_000],
    });
    const b = input({
      driverId: 'b',
      rankingLapsAscMs: [19_000, 19_500, 20_500],
    });
    expect(sortBy([a, b], 'practice').map((p) => p.driverId)).toEqual(['b', 'a']);
  });
});
