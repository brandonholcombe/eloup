import type Database from 'better-sqlite3';
import type { Role } from '@/lib/permissions';
import { categoryLabel } from '@/lib/games/categories';

export type PlayerRow = {
  id: string;
  discord_id: string;
  discord_handle: string;
  display_name: string;
  email: string | null;
  email_verified: number;
  avatar_url: string | null;
  role: Role;
  created_at: string;
};

export type GameRow = {
  id: string;
  name: string;
  slug: string;
  default_k: number;
  format: '1v1' | 'ffa' | 'team';
  min_participants: number;
  max_participants: number;
  category: string;
  created_at: string;
};

export function findPlayerByDiscordId(db: Database.Database, discordId: string): PlayerRow | null {
  const row = db.prepare('SELECT * FROM players WHERE discord_id = ?').get(discordId) as
    | PlayerRow
    | undefined;
  return row ?? null;
}

export function listGames(db: Database.Database): GameRow[] {
  return db.prepare('SELECT * FROM games ORDER BY name').all() as GameRow[];
}

export function getGame(db: Database.Database, id: string): GameRow | null {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
  return row ?? null;
}

export type LeaderRow = {
  player_id: string;
  discord_handle: string;
  display_name: string;
  avatar_url: string | null;
  current_rating: number;
  games_played?: number;
};

export function leaderboardForGame(db: Database.Database, gameId: string, limit = 50): LeaderRow[] {
  return db
    .prepare(
      `SELECT p.id AS player_id, p.discord_handle, p.display_name, p.avatar_url,
              r.current_rating, r.games_played
         FROM ratings r
         JOIN players p ON p.id = r.player_id
        WHERE r.game_id = ?
        ORDER BY r.current_rating DESC
        LIMIT ?`,
    )
    .all(gameId, limit) as LeaderRow[];
}

export type PlayerRank = { rank: number; total: number; current_rating: number };

// 1-based competition rank (rank = 1 + players strictly above), matching the
// leaderboard's `ORDER BY current_rating DESC`. null if the player is unranked
// in that pool. Used for the "your rank" affordance when outside the top-N.
export function overallPlayerRank(db: Database.Database, playerId: string): PlayerRank | null {
  const me = db
    .prepare(`SELECT current_rating FROM overall_ratings WHERE player_id = ?`)
    .get(playerId) as { current_rating: number } | undefined;
  if (!me) return null;
  const { c: higher } = db
    .prepare(`SELECT count(*) AS c FROM overall_ratings WHERE current_rating > ?`)
    .get(me.current_rating) as { c: number };
  const { c: total } = db.prepare(`SELECT count(*) AS c FROM overall_ratings`).get() as { c: number };
  return { rank: higher + 1, total, current_rating: me.current_rating };
}

export function gamePlayerRank(
  db: Database.Database,
  gameId: string,
  playerId: string,
): PlayerRank | null {
  const me = db
    .prepare(`SELECT current_rating FROM ratings WHERE game_id = ? AND player_id = ?`)
    .get(gameId, playerId) as { current_rating: number } | undefined;
  if (!me) return null;
  const { c: higher } = db
    .prepare(`SELECT count(*) AS c FROM ratings WHERE game_id = ? AND current_rating > ?`)
    .get(gameId, me.current_rating) as { c: number };
  const { c: total } = db
    .prepare(`SELECT count(*) AS c FROM ratings WHERE game_id = ?`)
    .get(gameId) as { c: number };
  return { rank: higher + 1, total, current_rating: me.current_rating };
}

export function overallLeaderboard(db: Database.Database, limit = 50): LeaderRow[] {
  return db
    .prepare(
      `SELECT p.id AS player_id, p.discord_handle, p.display_name, p.avatar_url,
              o.current_rating
         FROM overall_ratings o
         JOIN players p ON p.id = o.player_id
        ORDER BY o.current_rating DESC
        LIMIT ?`,
    )
    .all(limit) as LeaderRow[];
}

export type PlayerSearchHit = {
  id: string;
  display_name: string;
  discord_handle: string;
  avatar_url: string | null;
};

export type CategoryRollup = {
  category: string;
  label: string;
  weightedRating: number;
  gameCount: number;
  totalMatches: number;
};

// Weighted-average rating per category for one player.
//
// `SUM(current_rating * games_played) / SUM(games_played)` gives a
// matches-weighted average across all games in a category — a player
// with 10 matches at 1500 and 1 match at 1100 sits closer to 1500.
//
// Zero-match games are excluded (`r.games_played > 0`). A category that
// only holds zero-match games would otherwise divide by zero (SQLite
// returns NULL). The asymmetry with `playerGameRatings` (which DOES
// list zero-match games) is intentional: the per-game list is a
// registry ("which games does this player have a ratings row for?"),
// the rollup is a score ("how is this player doing in this category?"),
// and a starter 1200 with 0 matches would inject noise into the score.
//
// `CAST(ROUND(...) AS INTEGER)` returns SQLite's banker's rounding —
// `ROUND(1350.5) = 1350` (round-half-to-even). Tests pin this.
export function playerCategoryRatings(
  db: Database.Database,
  playerId: string,
): CategoryRollup[] {
  const rows = db
    .prepare(
      `SELECT g.category AS category,
              CAST(ROUND(SUM(r.current_rating * r.games_played) / SUM(r.games_played)) AS INTEGER) AS rating,
              COUNT(*) AS game_count,
              SUM(r.games_played) AS total_matches
         FROM ratings r
         JOIN games g ON g.id = r.game_id
        WHERE r.player_id = ?
          AND r.games_played > 0
        GROUP BY g.category
        ORDER BY rating DESC`,
    )
    .all(playerId) as Array<{
    category: string;
    rating: number;
    game_count: number;
    total_matches: number;
  }>;
  return rows.map((r) => ({
    category: r.category,
    label: categoryLabel(r.category),
    weightedRating: r.rating,
    gameCount: r.game_count,
    totalMatches: r.total_matches,
  }));
}

export type GameRating = {
  gameId: string;
  gameName: string;
  category: string;
  currentRating: number;
  gamesPlayed: number;
};

// Per-game rating list for one player, ordered by category then game
// name so the profile page can group rows in a single linear pass.
//
// Includes zero-match games — unlike `playerCategoryRatings`, which
// excludes them. See the comment on `playerCategoryRatings` for the
// rationale on the intentional asymmetry.
export function playerGameRatings(
  db: Database.Database,
  playerId: string,
): GameRating[] {
  const rows = db
    .prepare(
      `SELECT g.id   AS game_id,
              g.name AS game_name,
              g.category,
              r.current_rating,
              r.games_played
         FROM ratings r
         JOIN games g ON g.id = r.game_id
        WHERE r.player_id = ?
        ORDER BY g.category, g.name`,
    )
    .all(playerId) as Array<{
    game_id: string;
    game_name: string;
    category: string;
    current_rating: number;
    games_played: number;
  }>;
  return rows.map((r) => ({
    gameId: r.game_id,
    gameName: r.game_name,
    category: r.category,
    currentRating: r.current_rating,
    gamesPlayed: r.games_played,
  }));
}

// Case-insensitive substring search on display_name OR discord_handle.
// Empty / whitespace-only query short-circuits to [] so the result list
// never accidentally enumerates the player table on first keystroke.
// `%` and `_` in the query are escaped so a literal underscore in a
// Discord handle (e.g. `user_name`) matches the same handle, not any
// handle with *something* in that position. ESCAPE '\' on the SQL side
// tells SQLite the backslash is the escape character.
export function searchPlayers(
  db: Database.Database,
  query: string,
  limit = 5,
): PlayerSearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const escaped = trimmed.toLowerCase().replace(/[\\%_]/g, '\\$&');
  const like = `%${escaped}%`;
  return db
    .prepare(
      `SELECT id, display_name, discord_handle, avatar_url
         FROM players
        WHERE LOWER(display_name)   LIKE ? ESCAPE '\\'
           OR LOWER(discord_handle) LIKE ? ESCAPE '\\'
        ORDER BY display_name
        LIMIT ?`,
    )
    .all(like, like, limit) as PlayerSearchHit[];
}
