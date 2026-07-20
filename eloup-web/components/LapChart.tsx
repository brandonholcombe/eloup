'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import { driverColor } from '@/lib/rc/colors';
import { formatLapMs } from '@/lib/rc/format';

export type LapChartDriver = {
  driverId: string;
  displayName: string;
  laps: { lapNumber: number; lapTimeMs: number }[];
};

const WIDTH = 360;
const HEIGHT = 220;
const PADDING_X = 36;
const PADDING_Y = 18;
const CLIP_PERCENTILE = 0.95;
const LONG_PRESS_MS = 500;
// 5px movement tolerance — anything larger cancels the long-press timer.
// Squared to avoid sqrt at every pointermove tick.
const LONG_PRESS_MOVE_SQ = 25;

// 95th-percentile outlier clip — see r1-rc-racing-dashboard.md §"Resolved
// review notes" #1. Pinned by tests/unit/lap-chart-clip.test.ts.
export function lapChartClipMaxY(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * CLIP_PERCENTILE));
  return sorted[idx]!;
}

export type LapChartProps = {
  drivers: LapChartDriver[];
  // Default = all driver ids visible. When provided, drivers whose id is
  // not in the set are hidden from the SVG (no polyline, no dots) and
  // their chips render dimmed + dashed.
  visibleDriverIds?: Set<string>;
  // Tap → toggle. Long-press → isolate (visibility becomes {this driver}).
  onToggle?: (driverId: string) => void;
  onIsolate?: (driverId: string) => void;
};

export function LapChart({ drivers, visibleDriverIds, onToggle, onIsolate }: LapChartProps) {
  const visible =
    visibleDriverIds ?? new Set<string>(drivers.map((d) => d.driverId));

  // Y-axis tick computation filters to visible drivers only. As a
  // consequence the Y axis RE-SCALES whenever the visible set changes,
  // including on toggle-back. This is intentional — isolating an outlier
  // crasher lets the operator read the remaining drivers' pace at a
  // sensible scale. Filtering happens at the call site so
  // `lapChartClipMaxY` itself keeps the signature pinned by
  // tests/unit/lap-chart-clip.test.ts.
  const visibleTimes: number[] = [];
  let maxLap = 1;
  for (const d of drivers) {
    if (!visible.has(d.driverId)) continue;
    for (const l of d.laps) {
      visibleTimes.push(l.lapTimeMs);
      if (l.lapNumber > maxLap) maxLap = l.lapNumber;
    }
  }
  if (visibleTimes.length === 0) {
    return (
      <p className="rounded-md border border-border bg-card p-4 text-sm text-slate-400">
        No lap data for this race.
      </p>
    );
  }
  const minY = Math.min(...visibleTimes);
  const maxY = lapChartClipMaxY(visibleTimes);
  const spanY = Math.max(1, maxY - minY);

  const innerW = WIDTH - PADDING_X * 2;
  const innerH = HEIGHT - PADDING_Y * 2;

  const xFor = (lap: number) =>
    PADDING_X + (maxLap <= 1 ? innerW / 2 : ((lap - 1) / (maxLap - 1)) * innerW);
  const yFor = (ms: number) => {
    const clipped = Math.min(ms, maxY);
    return PADDING_Y + innerH - ((clipped - minY) / spanY) * innerH;
  };

  const ticksY = makeTicks(minY, maxY, 4);

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-2 overflow-x-auto pb-1">
        {drivers.map((d) => (
          <li key={d.driverId}>
            <DriverChip
              driver={d}
              isVisible={visible.has(d.driverId)}
              onToggle={onToggle}
              onIsolate={onIsolate}
            />
          </li>
        ))}
      </ul>
      <svg
        role="img"
        aria-label="Lap-time chart, one line per driver"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block w-full rounded-md border border-border bg-card"
      >
        {ticksY.map((t) => (
          <g key={t}>
            <line
              x1={PADDING_X}
              x2={WIDTH - PADDING_X}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="rgb(30 41 59)"
            />
            <text
              x={PADDING_X - 4}
              y={yFor(t) + 3}
              textAnchor="end"
              className="fill-slate-400 text-[9px] font-mono"
            >
              {formatLapMs(t)}
            </text>
          </g>
        ))}
        {drivers.map((d) => {
          if (!visible.has(d.driverId)) return null;
          const points = d.laps
            .filter((l) => l.lapNumber >= 1)
            .map((l) => `${xFor(l.lapNumber)},${yFor(l.lapTimeMs)}`)
            .join(' ');
          if (points.length === 0) return null;
          const color = driverColor(d.driverId);
          return (
            <g key={d.driverId}>
              <polyline
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points}
              >
                <title>{d.displayName}</title>
              </polyline>
              {d.laps
                .filter((l) => l.lapNumber >= 1)
                .map((l) => {
                  const clipped = l.lapTimeMs > maxY;
                  return (
                    <circle
                      key={`${d.driverId}-${l.lapNumber}`}
                      cx={xFor(l.lapNumber)}
                      cy={yFor(l.lapTimeMs)}
                      r={clipped ? 4 : 2.5}
                      fill={clipped ? 'transparent' : color}
                      stroke={color}
                      strokeWidth={clipped ? 1.5 : 0}
                    >
                      <title>{`${d.displayName} · lap ${l.lapNumber} · ${formatLapMs(l.lapTimeMs)}${clipped ? ' (clipped)' : ''}`}</title>
                    </circle>
                  );
                })}
            </g>
          );
        })}
        <text
          x={WIDTH / 2}
          y={HEIGHT - 2}
          textAnchor="middle"
          className="fill-slate-500 text-[9px]"
        >
          lap number
        </text>
      </svg>
    </div>
  );
}

type DriverChipProps = {
  driver: LapChartDriver;
  isVisible: boolean;
  onToggle?: (driverId: string) => void;
  onIsolate?: (driverId: string) => void;
};

function DriverChip({ driver, isVisible, onToggle, onIsolate }: DriverChipProps) {
  // Per-chip state lives in refs so React renders are not coupled to the
  // pointer lifecycle. `longPressFired` flips inside the timer callback;
  // the matching `onPointerUp` checks it before firing a toggle so a
  // long-press never also fires the short-tap path.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  };

  // Plain-display fallback when no toggle callbacks are provided
  // (preserves backward compatibility for any caller passing only
  // `drivers`).
  const interactive = Boolean(onToggle || onIsolate);

  const baseChip =
    'inline-flex h-tap min-w-tap items-center gap-1 rounded-full border px-2 py-1 text-xs';
  const visibilityClass = isVisible
    ? 'border-border bg-card text-slate-200'
    : 'border-dashed border-slate-700 bg-slate-900 text-slate-200 opacity-40';

  if (!interactive) {
    return (
      <span className={`${baseChip} ${visibilityClass}`}>
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: driverColor(driver.driverId) }}
        />
        <span>{driver.displayName}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      // touch-none disables the browser's default touch gestures
      // (scroll/pinch/double-tap) on this element so a 500ms hold goes
      // to our pointer handlers, not the OS text-selection / context
      // menu. onContextMenu preventDefault is the belt to touch-none's
      // suspenders — iOS Safari still fires contextmenu on long-press
      // even with touch-action set in some versions. Both are needed.
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
        longPressFired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          longPressFired.current = true;
          timer.current = null;
          if (onIsolate) onIsolate(driver.driverId);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLButtonElement>) => {
        if (!origin.current) return;
        const dx = e.clientX - origin.current.x;
        const dy = e.clientY - origin.current.y;
        if (dx * dx + dy * dy > LONG_PRESS_MOVE_SQ) cancel();
      }}
      onPointerUp={() => {
        const stillPending = timer.current !== null;
        cancel();
        if (stillPending && !longPressFired.current && onToggle) {
          onToggle(driver.driverId);
        }
      }}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      aria-pressed={isVisible}
      className={`${baseChip} touch-none ${visibilityClass}`}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: driverColor(driver.driverId) }}
      />
      <span>{driver.displayName}</span>
    </button>
  );
}

function makeTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const step = (max - min) / count;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Math.round(min + step * i));
  return ticks;
}
