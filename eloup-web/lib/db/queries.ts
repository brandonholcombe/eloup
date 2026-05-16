import type Database from 'better-sqlite3';
import type { Role } from '@/lib/permissions';

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
