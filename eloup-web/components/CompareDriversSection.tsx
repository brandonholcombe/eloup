'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { driverColor } from '@/lib/rc/colors';
import { formatLapMs } from '@/lib/rc/format';
import type { DriverStats } from '@/lib/rc/stats';

export type CompareDriver = {
  driverId: string;
  displayName: string;
  stats: DriverStats;
};

type Props = {
  drivers: CompareDriver[];
  // @internal — vitest seam. Production callers should NOT pass this;
  // initial state is derived from `?compare=` via useSearchParams.
  initialSelected?: string[];
};

const COMPARE_PARAM = 'compare';
const MAX_PICK = 3;

function parseSelection(raw: string | null, available: Set<string>): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((id) => id.length > 0 && available.has(id))
    .slice(0, MAX_PICK);
}

function buildHref(pathname: string, ids: string[]): string {
  if (ids.length === 0) return pathname;
  return `${pathname}?${COMPARE_PARAM}=${ids.join(',')}`;
}

export function CompareDriversSection({ drivers, initialSelected }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // 1-driver races render no compare section at all (per reviewer Q5).
  // Doing this AFTER the hook calls would violate rules-of-hooks; we
  // call the hooks unconditionally and bail before useState below.
  const available = useMemo(
    () => new Set(drivers.map((d) => d.driverId)),
    [drivers],
  );
  const fromUrl = useMemo(
    () => parseSelection(searchParams.get(COMPARE_PARAM), available),
    [searchParams, available],
  );
  const seedSelection = initialSelected
    ? initialSelected.filter((id) => available.has(id)).slice(0, MAX_PICK)
    : fromUrl;

  const [selected, setSelected] = useState<string[]>(seedSelection);

  if (drivers.length < 2) {
    return null;
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      let next: string[];
      if (prev.includes(id)) {
        next = prev.filter((x) => x !== id);
      } else if (prev.length < MAX_PICK) {
        next = [...prev, id];
      } else {
        // FIFO eviction — drop the oldest selection so a 4th tap
        // produces a coherent 3-driver compare instead of refusing
        // the input.
        next = [...prev.slice(1), id];
      }
      // Mirror state → URL synchronously inside the toggle callback
      // (NOT inside a useEffect). The effect form fires on mount with
      // empty selection and clobbers unrelated query params; the
      // sync form only writes when state actually changes.
      router.replace(buildHref(pathname, next), { scroll: false });
      return next;
    });
  };

  const picked = selected
    .map((id) => drivers.find((d) => d.driverId === id))
    .filter((d): d is CompareDriver => Boolean(d));

  return (
    <section className="mt-6">
      <h2 className="text-lg font-medium">Compare drivers</h2>
      <p className="mt-1 text-xs text-slate-500">
        Pick 2–3 drivers to compare side-by-side. Tap to toggle.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {drivers.map((d) => {
          const on = selected.includes(d.driverId);
          return (
            <li key={d.driverId}>
              <button
                type="button"
                // Same iOS Safari hardening as LapChart chips — even
                // though this button has no long-press behaviour, the
                // touch-none + onContextMenu pair prevents Safari's
                // system text-selection popover from firing on a hold.
                onContextMenu={(e) => e.preventDefault()}
                aria-pressed={on}
                onClick={() => toggle(d.driverId)}
                className={
                  'inline-flex h-tap min-w-tap touch-none items-center gap-1 rounded-full border px-3 text-xs ' +
                  (on
                    ? 'border-blue-400 bg-blue-500/20 text-blue-100'
                    : 'border-slate-800 bg-slate-900 text-slate-200')
                }
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: driverColor(d.driverId) }}
                />
                <span>{d.displayName}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {picked.length < 2 ? (
        <p className="mt-3 text-xs text-slate-500">
          Select at least 2 drivers above to see the comparison.
        </p>
      ) : (
        <CompareTable picked={picked} />
      )}
    </section>
  );
}

function CompareTable({ picked }: { picked: CompareDriver[] }) {
  const rows: Array<{ label: string; value: (s: DriverStats) => string }> = [
    { label: 'Best', value: (s) => optional(s.bestMs) },
    { label: 'Average', value: (s) => optional(s.avgMs) },
    { label: 'Top 3 avg', value: (s) => optional(s.top3AvgMs) },
    { label: 'Top 5 avg', value: (s) => optional(s.top5AvgMs) },
    { label: 'Median', value: (s) => optional(s.medianMs) },
    {
      label: 'Consistency',
      value: (s) => (s.consistencyMs == null ? '—' : `± ${formatLapMs(s.consistencyMs)}`),
    },
    { label: 'First lap', value: (s) => optional(s.firstLapMs) },
    { label: 'Counted', value: (s) => String(s.countedLaps) },
  ];
  return (
    <table className="mt-3 w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="py-1 pr-2 font-normal">Stat</th>
          {picked.map((d) => (
            <th key={d.driverId} className="py-1 pr-2 text-right font-normal">
              <span
                aria-hidden
                className="mr-1 inline-block h-2 w-2 rounded-full"
                style={{ background: driverColor(d.driverId) }}
              />
              {d.displayName}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-slate-800">
            <td className="py-1 pr-2 text-slate-400">{r.label}</td>
            {picked.map((d) => (
              <td key={d.driverId} className="py-1 pr-2 text-right font-mono tabular-nums">
                {r.value(d.stats)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function optional(ms: number | null): string {
  return ms == null ? '—' : formatLapMs(ms);
}
