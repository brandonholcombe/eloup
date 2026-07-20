import { describe, expect, it } from 'vitest';
import { isNavItemActive } from '@/lib/nav';

describe('isNavItemActive', () => {
  it('is active on the exact route', () => {
    expect(isNavItemActive('/matches', '/matches')).toBe(true);
  });

  it('is active on a sub-route (detail page lights the parent tab)', () => {
    expect(isNavItemActive('/matches/abc123', '/matches')).toBe(true);
    expect(isNavItemActive('/racing/tracks/oval', '/racing')).toBe(true);
    expect(isNavItemActive('/tournaments/summer-cup', '/tournaments')).toBe(true);
  });

  it('does not activate a different tab', () => {
    expect(isNavItemActive('/matches', '/tournaments')).toBe(false);
    expect(isNavItemActive('/leaderboards', '/racing')).toBe(false);
  });

  it('does not treat a shared prefix without a slash as a sub-route', () => {
    // '/matches-archive' must NOT light the '/matches' tab.
    expect(isNavItemActive('/matches-archive', '/matches')).toBe(false);
  });
});
