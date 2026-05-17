// A "normal" lap is treated as a strong outlier when it exceeds N × the
// driver's fastest lap in that race. Default N=2 matches the empirical
// rule of thumb K1 Speed and other timing systems use: anything over 2×
// fastest is almost certainly a crash, marshall reset, or off-track
// recovery — not a representative race lap. The DB row stays put so
// audit views can still surface it; this filter is for charts and
// pace-derived stats only.
export const DEFAULT_OUTLIER_MULTIPLIER = 2;

export function isLapOutlier(
  lapMs: number,
  driverBestLapMs: number | null,
  multiplier: number = DEFAULT_OUTLIER_MULTIPLIER,
): boolean {
  if (driverBestLapMs == null || driverBestLapMs <= 0) return false;
  return lapMs > driverBestLapMs * multiplier;
}
