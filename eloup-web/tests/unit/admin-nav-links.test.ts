import { describe, expect, it } from 'vitest';
import { adminNavLinks } from '@/lib/permissions';

describe('adminNavLinks', () => {
  it('returns the /games link for global_admin', () => {
    expect(adminNavLinks('global_admin')).toEqual([{ href: '/games', label: 'Games' }]);
  });

  it('returns no links for plain users', () => {
    expect(adminNavLinks('user')).toEqual([]);
  });

  it('returns no links for tournament_admin (no global catalog access)', () => {
    expect(adminNavLinks('tournament_admin')).toEqual([]);
  });

  it('returns no links when role is undefined', () => {
    expect(adminNavLinks(undefined)).toEqual([]);
  });
});
