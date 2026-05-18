import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { LapChart, type LapChartDriver } from '@/components/LapChart';

const DRIVERS: LapChartDriver[] = [
  {
    driverId: 'd1',
    displayName: 'Alice',
    laps: [
      { lapNumber: 1, lapTimeMs: 2000 },
      { lapNumber: 2, lapTimeMs: 2100 },
      { lapNumber: 3, lapTimeMs: 2050 },
    ],
  },
  {
    driverId: 'd2',
    displayName: 'Bob',
    laps: [
      { lapNumber: 1, lapTimeMs: 2200 },
      { lapNumber: 2, lapTimeMs: 2300 },
      { lapNumber: 3, lapTimeMs: 2150 },
    ],
  },
  {
    driverId: 'd3',
    displayName: 'Carol',
    laps: [
      { lapNumber: 1, lapTimeMs: 2400 },
      { lapNumber: 2, lapTimeMs: 2500 },
      { lapNumber: 3, lapTimeMs: 2350 },
    ],
  },
];

function countMatches(haystack: string, needle: RegExp): number {
  return (haystack.match(needle) ?? []).length;
}

describe('LapChart visibleDriverIds', () => {
  it('renders all polylines when no visibleDriverIds prop is provided', () => {
    const html = renderToStaticMarkup(createElement(LapChart, { drivers: DRIVERS }));
    expect(countMatches(html, /<polyline/g)).toBe(3);
  });

  it('renders only polylines for ids in visibleDriverIds', () => {
    const html = renderToStaticMarkup(
      createElement(LapChart, {
        drivers: DRIVERS,
        visibleDriverIds: new Set(['d1']),
      }),
    );
    expect(countMatches(html, /<polyline/g)).toBe(1);
    expect(html).toContain('Alice');
    // Chips for hidden drivers still render (so the operator can re-enable)
    expect(html).toContain('Bob');
    expect(html).toContain('Carol');
  });

  it('hidden chips render with opacity-40 + border-dashed classes', () => {
    const html = renderToStaticMarkup(
      createElement(LapChart, {
        drivers: DRIVERS,
        visibleDriverIds: new Set(['d1']),
        onToggle: () => {},
      }),
    );
    expect(html).toContain('opacity-40');
    expect(html).toContain('border-dashed');
  });

  it('visible chips do not get opacity-40', () => {
    const html = renderToStaticMarkup(
      createElement(LapChart, {
        drivers: DRIVERS,
        visibleDriverIds: new Set(['d1', 'd2', 'd3']),
        onToggle: () => {},
      }),
    );
    // No chip should be opacity-40 when every driver is visible.
    expect(countMatches(html, /opacity-40/g)).toBe(0);
  });

  it('interactive chips set onContextMenu suppression class touch-none', () => {
    const html = renderToStaticMarkup(
      createElement(LapChart, {
        drivers: DRIVERS,
        visibleDriverIds: new Set(DRIVERS.map((d) => d.driverId)),
        onToggle: () => {},
      }),
    );
    // touch-none is the iOS Safari context-menu suppression — every
    // interactive chip carries it. 3 drivers, 3 occurrences.
    expect(countMatches(html, /touch-none/g)).toBe(3);
  });

  it('shows "no data" placeholder when visibleDriverIds resolves to zero laps', () => {
    const html = renderToStaticMarkup(
      createElement(LapChart, {
        drivers: DRIVERS,
        visibleDriverIds: new Set(['nonexistent']),
      }),
    );
    expect(html).toContain('No lap data');
  });
});
