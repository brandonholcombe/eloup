// RC cup points-series scoring — PURE (no DB), so it's unit-testable. See
// Agents/TODO/Active/m8b-rc-cup.md. Standings aggregate points-by-finish over a
// cup's races, keyed on driver_id (rc_drivers.player_id is nullable).

export const DEFAULT_POINTS_SCHEME = [10, 8, 6, 5, 4, 3, 2, 1];

/** One driver's result in one race of the cup. */
export type CupResultRow = {
  driver_id: string;
  display_name: string;
  player_id: string | null;
  placement: number; // 1-based, dense per race
};

export type CupStanding = {
  driverId: string;
  displayName: string;
  playerId: string | null;
  points: number;
  races: number;
  wins: number; // placement === 1
  best: number; // best (lowest) placement
};

/** Points for a finishing position under a scheme (0 beyond the scheme). */
export function pointsFor(scheme: number[], placement: number): number {
  if (placement < 1) return 0;
  return scheme[placement - 1] ?? 0;
}

/**
 * Aggregate cup standings from raw per-race driver rows. Ranked by
 * points desc → wins desc → best-finish asc → display_name → driver_id (S2:
 * driver_id is the stable terminal tiebreak since display_name isn't unique).
 */
export function scoreCup(rows: CupResultRow[], scheme: number[]): CupStanding[] {
  const byDriver = new Map<string, CupStanding>();
  for (const r of rows) {
    let s = byDriver.get(r.driver_id);
    if (!s) {
      s = {
        driverId: r.driver_id,
        displayName: r.display_name,
        playerId: r.player_id,
        points: 0,
        races: 0,
        wins: 0,
        best: Infinity,
      };
      byDriver.set(r.driver_id, s);
    }
    s.points += pointsFor(scheme, r.placement);
    s.races += 1;
    if (r.placement === 1) s.wins += 1;
    if (r.placement < s.best) s.best = r.placement;
  }
  return [...byDriver.values()]
    .map((s) => ({ ...s, best: s.best === Infinity ? 0 : s.best }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        a.best - b.best ||
        a.displayName.localeCompare(b.displayName) ||
        a.driverId.localeCompare(b.driverId),
    );
}

/**
 * Validate a points scheme (S3): a non-empty array of non-negative integers.
 * Returns the parsed array or throws.
 */
export function parsePointsScheme(input: unknown): number[] {
  const arr = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('points_scheme must be a non-empty array');
  }
  const scheme = arr.map((v) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      throw new Error('points_scheme entries must be non-negative integers');
    }
    return v;
  });
  return scheme;
}
