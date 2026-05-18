// Render a race-recorded ISO timestamp as the local time it was
// recorded in, NOT shifted to the server's timezone. The production
// pod runs as TZ=UTC; using `new Date(iso).toLocaleString(undefined)`
// would translate the stored offset to UTC and show 4:51 PM for a
// 9:51 AM PDT race. We slice the ISO components directly to preserve
// the recorded wall-clock across SSR (UTC pod), CSR (visitor zone),
// and local dev.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

// Permissive ISO regex: requires a full YYYY-MM-DDThh:mm[:ss[.fraction]]
// optionally followed by Z or +/-HH:MM (or +/-HHMM). Date-only strings
// (no `T` separator) are rejected — pass a full timestamp.
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function formatRecordedDate(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  const monthIdx = Number(mo) - 1;
  if (monthIdx < 0 || monthIdx > 11) return iso;
  const monthName = MONTHS[monthIdx]!;
  const dayNum = Number(d);
  const yearNum = Number(y);
  const hourNum = Number(h);
  const period = hourNum >= 12 ? 'PM' : 'AM';
  const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12;
  return `${monthName} ${dayNum}, ${yearNum}, ${hour12}:${mi} ${period}`;
}

// Expects a full ISO timestamp with `T`. Date-only strings (e.g.
// "2026-05-03") are not supported and return verbatim.
export function formatRecordedDateOnly(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const monthIdx = Number(mo) - 1;
  if (monthIdx < 0 || monthIdx > 11) return iso;
  return `${MONTHS[monthIdx]!} ${Number(d)}, ${y}`;
}
