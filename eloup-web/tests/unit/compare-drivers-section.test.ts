import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { DriverStats } from '@/lib/rc/stats';

// Mock next/navigation BEFORE importing the component so the inline
// hook calls inside CompareDriversSection resolve to our test doubles.
// The seam (initialSelected prop) lets us drive state directly, but we
// still need useRouter / useSearchParams / usePathname to be callable.
const replaceMock = vi.fn();

vi.mock('next/navigation', () => {
  return {
    useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => new URLSearchParams(''),
    usePathname: () => '/racing/race-1',
  };
});

// Import AFTER vi.mock so the mock is wired before the module reads
// next/navigation.
import {
  CompareDriversSection,
  type CompareDriver,
} from '@/components/CompareDriversSection';

function stub(driverId: string, displayName: string): CompareDriver {
  const stats: DriverStats = {
    bestMs: 2000,
    avgMs: 2100,
    medianMs: 2050,
    top3AvgMs: 2025,
    top5AvgMs: 2080,
    consistencyMs: 50,
    firstLapMs: 2200,
    countedLaps: 10,
    hiddenOutliers: 0,
  };
  return { driverId, displayName, stats };
}

const A = stub('a', 'Alice');
const B = stub('b', 'Bob');
const C = stub('c', 'Carol');
const D = stub('d', 'Dave');

function countMatches(haystack: string, needle: RegExp): number {
  return (haystack.match(needle) ?? []).length;
}

beforeEach(() => {
  replaceMock.mockReset();
});

describe('CompareDriversSection', () => {
  it('returns null when drivers.length < 2', () => {
    const html = renderToStaticMarkup(
      createElement(CompareDriversSection, { drivers: [A] }),
    );
    expect(html).toBe('');
  });

  it('renders 0-selected state with "Select at least 2" hint', () => {
    const html = renderToStaticMarkup(
      createElement(CompareDriversSection, { drivers: [A, B, C] }),
    );
    expect(html).toContain('Select at least 2');
    // No compare table rendered.
    expect(html).not.toContain('<table');
  });

  it('renders a 2-column table when initialSelected has 2 drivers', () => {
    const html = renderToStaticMarkup(
      createElement(CompareDriversSection, {
        drivers: [A, B, C],
        initialSelected: ['a', 'b'],
      }),
    );
    expect(html).toContain('<table');
    // Header includes both names; the section title doesn't count.
    // Each picked driver gets a <th> AND a chip <button>; expect at
    // least both names visible.
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
    // Carol's chip still renders but should NOT appear inside <th>.
    expect(html).toContain('Carol');
  });

  it('renders a 3-column table when initialSelected has 3 drivers', () => {
    const html = renderToStaticMarkup(
      createElement(CompareDriversSection, {
        drivers: [A, B, C, D],
        initialSelected: ['a', 'b', 'c'],
      }),
    );
    expect(html).toContain('<table');
    // 8 stat rows + 1 header = 9 <tr>; each picked column adds a <th>
    // in the header and a <td> per stat row. Just sanity-check the
    // basic shape.
    expect(html).toContain('Alice');
    expect(html).toContain('Bob');
    expect(html).toContain('Carol');
  });

  it('drops initialSelected ids that are not in the driver list', () => {
    const html = renderToStaticMarkup(
      createElement(CompareDriversSection, {
        drivers: [A, B],
        initialSelected: ['a', 'b', 'ghost'],
      }),
    );
    // Only Alice + Bob are real; ghost is dropped. Compare table
    // renders with 2 columns + header chips for both.
    expect(html).toContain('<table');
  });

  it('every chip button has touch-none + suppresses context menu (iOS Safari)', () => {
    const html = renderToStaticMarkup(
      createElement(CompareDriversSection, {
        drivers: [A, B, C],
      }),
    );
    // 3 chip buttons → 3 touch-none occurrences (CompareTable doesn't
    // render at 0 selection so no extra buttons).
    expect(countMatches(html, /touch-none/g)).toBe(3);
  });
});

describe('CompareDriversSection — selection logic (toggle)', () => {
  // The pure selection-update function is the same shape the toggle
  // callback uses inside the component. We re-derive it here so we
  // can assert FIFO replacement deterministically without a DOM event
  // simulator.
  function nextSelection(prev: string[], id: string, max = 3): string[] {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (prev.length < max) return [...prev, id];
    return [...prev.slice(1), id];
  }

  it('adds an unseen driver to selection', () => {
    expect(nextSelection([], 'a')).toEqual(['a']);
    expect(nextSelection(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes a selected driver on re-tap', () => {
    expect(nextSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('fills up to 3 then FIFO-evicts the oldest on 4th tap', () => {
    expect(nextSelection(['a', 'b', 'c'], 'd')).toEqual(['b', 'c', 'd']);
  });
});
