// Shared placement-ordering primitives. Single authoritative sort
// function, two callers (the JSON+TXT importer at insert time and
// `recomputePlacements` in `lib/db/rc.ts` after a penalty/void mutation).
// Branches on `RaceKind` once at the top to keep the cost simple to reason
// about.

export type RaceKind = 'practice' | 'qualif' | 'race';

export type PlacementInput = {
  driverId: string;
  lapsCompleted: number;
  bestLapMs: number | null;
  totalTimeMs: number;
  penaltyMs: number;
  // Normal lap times sorted asc, with the first `voidedLapsCount` entries
  // already stripped by the caller (via `rankingLapTimes`). Used for the
  // top-3-avg ranking on qualif/practice. The sort never consults
  // `voidedLapsCount` directly — stripping is the caller's responsibility.
  rankingLapsAscMs: number[];
  transponderId: number;
};

// Strip the first N (fastest) entries from a sorted-ascending lap-time
// array. Pure function. Used by both `comparePlacement` callers and the
// DB-side recompute in `lib/db/rc.ts`.
export function rankingLapTimes(
  normalLapTimesAscMs: number[],
  voidedLapsCount: number,
): number[] {
  if (voidedLapsCount <= 0) return normalLapTimesAscMs;
  return normalLapTimesAscMs.slice(voidedLapsCount);
}

export function comparePlacement(
  a: PlacementInput,
  b: PlacementInput,
  raceKind: RaceKind,
): number {
  if (raceKind === 'race') {
    if (a.lapsCompleted !== b.lapsCompleted) {
      return b.lapsCompleted - a.lapsCompleted;
    }
    const at = a.totalTimeMs + a.penaltyMs;
    const bt = b.totalTimeMs + b.penaltyMs;
    if (at !== bt) return at - bt;
    return a.transponderId - b.transponderId;
  }
  // qualif / practice: top-3-avg of ranking laps.
  const aHas3 = a.rankingLapsAscMs.length >= 3;
  const bHas3 = b.rankingLapsAscMs.length >= 3;
  if (aHas3 !== bHas3) return aHas3 ? -1 : 1;
  if (!aHas3) {
    // Both have <3 ranking laps — best-lap ASC (null = last), then
    // transponder ASC. The <3-lap fallback explicitly sinks below
    // 3-lap drivers (guarded above).
    const ab = bestOrInf(a.bestLapMs);
    const bb = bestOrInf(b.bestLapMs);
    if (ab !== bb) return ab - bb;
    return a.transponderId - b.transponderId;
  }
  const aAvg = (a.rankingLapsAscMs[0]! + a.rankingLapsAscMs[1]! + a.rankingLapsAscMs[2]!) / 3;
  const bAvg = (b.rankingLapsAscMs[0]! + b.rankingLapsAscMs[1]! + b.rankingLapsAscMs[2]!) / 3;
  if (aAvg !== bAvg) return aAvg - bAvg;
  const ab = bestOrInf(a.bestLapMs);
  const bb = bestOrInf(b.bestLapMs);
  if (ab !== bb) return ab - bb;
  if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
  return a.transponderId - b.transponderId;
}

function bestOrInf(x: number | null): number {
  return x == null ? Number.POSITIVE_INFINITY : x;
}
