import { describe, expect, it } from 'vitest';
import { canEditRace, canUploadRaceResults } from '@/lib/permissions';

describe('canUploadRaceResults', () => {
  it('global_admin → true', () => {
    expect(canUploadRaceResults({ id: 'a', role: 'global_admin' })).toBe(true);
  });
  it('tournament_admin → false', () => {
    expect(canUploadRaceResults({ id: 'a', role: 'tournament_admin' })).toBe(false);
  });
  it('user → false', () => {
    expect(canUploadRaceResults({ id: 'a', role: 'user' })).toBe(false);
  });
  it('null (anonymous) → false', () => {
    expect(canUploadRaceResults(null)).toBe(false);
  });
});

describe('canEditRace', () => {
  it('global_admin → true', () => {
    expect(canEditRace({ id: 'a', role: 'global_admin' })).toBe(true);
  });
  it('tournament_admin → false', () => {
    expect(canEditRace({ id: 'a', role: 'tournament_admin' })).toBe(false);
  });
  it('user → false', () => {
    expect(canEditRace({ id: 'a', role: 'user' })).toBe(false);
  });
  it('null (anonymous) → false', () => {
    expect(canEditRace(null)).toBe(false);
  });
});
