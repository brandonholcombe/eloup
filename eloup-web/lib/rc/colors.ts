// Deterministic color per driver — same driver_id always renders with the
// same hue across pages so a viewer can follow them between races.
export function driverColor(driverId: string): string {
  let h = 2166136261;
  for (let i = 0; i < driverId.length; i++) {
    h ^= driverId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = ((h >>> 0) % 360);
  return `hsl(${hue} 70% 55%)`;
}
