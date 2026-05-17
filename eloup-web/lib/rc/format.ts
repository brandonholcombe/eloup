// Format milliseconds as mm:ss.mmm. Negative inputs are clamped to 0 — the
// renderer must never display "−00:00.500" for noisy device data.
export function formatLapMs(ms: number): string {
  const n = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const minutes = Math.floor(n / 60_000);
  const seconds = Math.floor((n % 60_000) / 1000);
  const millis = n % 1000;
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}
