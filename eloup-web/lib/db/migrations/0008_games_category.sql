-- 0008_games_category.sql — Tag each game with a category for the
-- profile per-category ELO rollup. App-side validation via
-- lib/games/categories.ts decides which slugs are valid; the DB
-- accepts any TEXT so adding a category is a 1-line code change with
-- no migration. Existing rows get 'other' atomically via the DEFAULT
-- (SQLite 3.37+ supports NOT NULL DEFAULT on ADD COLUMN). See
-- Agents/TODO/Active/h7-profile-expansions.md.

ALTER TABLE games
  ADD COLUMN category TEXT NOT NULL DEFAULT 'other';

CREATE INDEX idx_games_category ON games(category);
