// H7 — Game categories module.
//
// Categories are owned in code, not in the DB. Adding a new category is
// a 1-line append below + a follow-up commit to update existing rows via
// the /games admin UI. The DB column (games.category) is a plain TEXT
// with DEFAULT 'other' and no CHECK constraint — so a category removed
// here continues to live in any games row that already points at it,
// without breaking writes. `categoryLabel` falls back to the raw slug
// for unknown values so legacy rows render rather than crash.

export const GAME_CATEGORIES = [
  { slug: 'racing', label: 'Racing' },
  { slug: 'fighting', label: 'Fighting' },
  { slug: 'shooting', label: 'Shooting' },
  { slug: 'yard', label: 'Yard' },
  { slug: 'bar', label: 'Bar' },
  { slug: 'tabletop', label: 'Tabletop' },
  { slug: 'video', label: 'Video' },
  { slug: 'other', label: 'Other' },
] as const;

export type GameCategorySlug = (typeof GAME_CATEGORIES)[number]['slug'];

// `as readonly GameCategorySlug[]` keeps the literal-union slug type so
// zod's `z.enum(GAME_CATEGORY_SLUGS as [...])` cast retains inference.
export const GAME_CATEGORY_SLUGS = GAME_CATEGORIES.map((c) => c.slug) as readonly GameCategorySlug[];

export function isKnownCategory(slug: string): slug is GameCategorySlug {
  return GAME_CATEGORIES.some((c) => c.slug === slug);
}

export function categoryLabel(slug: string): string {
  const found = GAME_CATEGORIES.find((c) => c.slug === slug);
  return found?.label ?? slug;
}
