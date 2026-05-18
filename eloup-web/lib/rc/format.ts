// Format milliseconds as mm:ss.cc — centisecond precision. Lap Monitor's
// source precision is 1/100 second; showing milliseconds would imply
// precision the timing system doesn't actually provide. Negative inputs
// are clamped to 0 — the renderer must never display "−00:00.50" for
// noisy device data.
export function formatLapMs(ms: number): string {
  const n = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const minutes = Math.floor(n / 60_000);
  const seconds = Math.floor((n % 60_000) / 1000);
  const centis = Math.floor((n % 1000) / 10);
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(centis, 2)}`;
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}
