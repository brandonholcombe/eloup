import { describe, expect, it } from 'vitest';
import {
  GAME_CATEGORIES,
  GAME_CATEGORY_SLUGS,
  categoryLabel,
  isKnownCategory,
} from '@/lib/games/categories';

describe('game categories module', () => {
  it('exports exactly 8 categories (H7 baseline)', () => {
    expect(GAME_CATEGORIES.length).toBe(8);
    expect(GAME_CATEGORY_SLUGS.length).toBe(8);
  });

  it('isKnownCategory returns true for every defined slug', () => {
    for (const c of GAME_CATEGORIES) {
      expect(isKnownCategory(c.slug)).toBe(true);
    }
  });

  it('isKnownCategory returns false for unknown slugs', () => {
    expect(isKnownCategory('mmo')).toBe(false);
    expect(isKnownCategory('')).toBe(false);
    expect(isKnownCategory('Racing')).toBe(false); // case-sensitive
  });

  it('categoryLabel returns the Title-Cased label for a known slug', () => {
    expect(categoryLabel('yard')).toBe('Yard');
    expect(categoryLabel('tabletop')).toBe('Tabletop');
    expect(categoryLabel('other')).toBe('Other');
  });

  it('categoryLabel falls back to the raw slug for unknown values', () => {
    // A legacy row whose category was dropped from the in-code list still
    // renders something rather than crashing.
    expect(categoryLabel('mystery-slug')).toBe('mystery-slug');
    expect(categoryLabel('')).toBe('');
  });
});
