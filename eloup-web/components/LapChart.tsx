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

// 95th-percentile outlier clip — see r1-rc-racing-dashboard.md §"Resolved
// review notes" #1. Pinned by tests/unit/lap-chart-clip.test.ts.
export function lapChartClipMaxY(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * CLIP_PERCENTILE));
  return sorted[idx]!;
}

export function LapChart({ drivers }: { drivers: LapChartDriver[] }) {
  const allTimes: number[] = [];
  let maxLap = 1;
  for (const d of drivers) {
    for (const l of d.laps) {
      allTimes.push(l.lapTimeMs);
      if (l.lapNumber > maxLap) maxLap = l.lapNumber;
    }
  }
  if (allTimes.length === 0) {
    return (
      <p className="rounded-md border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
        No lap data for this race.
      </p>
    );
  }
  const minY = Math.min(...allTimes);
  const maxY = lapChartClipMaxY(allTimes);
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
          <li
            key={d.driverId}
            className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: driverColor(d.driverId) }}
            />
            <span className="text-slate-200">{d.displayName}</span>
          </li>
        ))}
      </ul>
      <svg
        role="img"
        aria-label="Lap-time chart, one line per driver"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block w-full rounded-md border border-slate-800 bg-slate-900"
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
          const visible = d.laps.filter((l) => l.lapNumber >= 1);
          if (visible.length === 0) return null;
          const points = visible.map((l) => `${xFor(l.lapNumber)},${yFor(l.lapTimeMs)}`).join(' ');
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
              {visible.map((l) => {
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

function makeTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const step = (max - min) / count;
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Math.round(min + step * i));
  return ticks;
}
