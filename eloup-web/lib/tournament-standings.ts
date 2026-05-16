import type Database from 'better-sqlite3';

export type StandingsRow = {
  player_id: string;
  display_name: string;
  avatar_url: string | null;
  overall_rating: number | null;
  wins: number;
  matches_played: number;
};

// Join order matters: matches m must be the outer LEFT JOIN (anchored on
// tournament_id + status='confirmed'), and match_participants joins through
// it. The intuitive "join mp on player_id first, then narrow with m" structure
// leaks casual matches into the counts.
export function getStandings(
  db: Database.Database,
  tournamentId: string,
): StandingsRow[] {
  return db
    .prepare(
      `SELECT
         p.id              AS player_id,
         p.display_name,
         p.avatar_url,
         o.current_rating  AS overall_rating,
         COUNT(CASE WHEN mp.placement = 1 THEN 1 END) AS wins,
         COUNT(mp.match_id)                            AS matches_played
       FROM tournament_members tm
       JOIN players p              ON p.id = tm.player_id
       LEFT JOIN overall_ratings o ON o.player_id = tm.player_id
       LEFT JOIN matches m
              ON m.tournament_id = tm.tournament_id
             AND m.status = 'confirmed'
       LEFT JOIN match_participants mp
              ON mp.match_id  = m.id
             AND mp.player_id = tm.player_id
       WHERE tm.tournament_id = ?
       GROUP BY p.id, p.display_name, p.avatar_url, o.current_rating
       ORDER BY wins DESC,
                CASE WHEN COUNT(mp.match_id) > 0 THEN 0 ELSE 1 END ASC,
                matches_played ASC,
                overall_rating DESC,
                p.display_name ASC`,
    )
    .all(tournamentId) as StandingsRow[];
}
