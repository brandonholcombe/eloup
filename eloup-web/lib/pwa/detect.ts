// Pure platform detection for the install prompt (H11) — unit-testable.
export type Platform = 'ios' | 'android' | 'other';

// iOS/iPadOS Safari; iPadOS 13+ reports a Macintosh UA, so detect it via touch
// (Apple ships no touchscreen Macs, and macOS Safari reports maxTouchPoints=0).
export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  const isIos =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (isIos) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}
