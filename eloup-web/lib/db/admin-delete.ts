import type Database from 'better-sqlite3';
import { purgeOrphanGuests } from '@/lib/tournaments';

// Admin deletion of matches + tournaments, reversing the ELO those matches
// applied (H10). Reversal uses the stored per-game rating_delta + the overall
// delta persisted since migration 0011. Exact when deleting newest-first,
// approximate out of order (per the party decision). Only 'confirmed' matches
// carry deltas to reverse.

type PartRow = {
  player_id: string;
  rating_delta: number | null;
  overall_rating_delta: number | null;
};

/** Reverse one confirmed match's ELO effect (per-game + overall). No-op if the
 *  match isn't confirmed. Must run inside a transaction. */
function reverseMatchElo(db: Database.Database, matchId: string): void {
  const m = db.prepare(`SELECT game_id, status FROM matches WHERE id = ?`).get(matchId) as
    | { game_id: string; status: string }
    | undefined;
  if (!m || m.status !== 'confirmed') return;
  const parts = db
    .prepare(
      `SELECT player_id, rating_delta, overall_rating_delta FROM match_participants WHERE match_id = ?`,
    )
    .all(matchId) as PartRow[];
  const perGame = db.prepare(
    // per-game ratings are intentionally NOT floored (rating.floor is overall-only).
    `UPDATE ratings SET current_rating = current_rating - ?, games_played = MAX(0, games_played - 1)
      WHERE player_id = ? AND game_id = ?`,
  );
  const overall = db.prepare(
    // clamp at 0 to respect overall_ratings' CHECK (current_rating >= 0).
    `UPDATE overall_ratings SET current_rating = MAX(0, current_rating - ?) WHERE player_id = ?`,
  );
  for (const p of parts) {
    if (p.rating_delta != null) perGame.run(p.rating_delta, p.player_id, m.game_id);
    overall.run(p.overall_rating_delta ?? 0, p.player_id);
  }
}

export type DeleteMatchResult = { status: 'ok' | 'not_found' | 'bracket_linked' };

/**
 * Delete a single match, reversing its ELO if confirmed. Blocked if the match is
 * a played bracket result (bracket_matches.match_id) — the bracket is
 * authoritative; delete the whole tournament to remove a bracket. One transaction.
 */
export function deleteMatch(db: Database.Database, matchId: string): DeleteMatchResult {
  const tx = db.transaction((): DeleteMatchResult => {
    const exists = db.prepare(`SELECT 1 FROM matches WHERE id = ?`).get(matchId);
    if (!exists) return { status: 'not_found' };
    const linked = db.prepare(`SELECT 1 FROM bracket_matches WHERE match_id = ?`).get(matchId);
    if (linked) return { status: 'bracket_linked' };

    reverseMatchElo(db, matchId); // no-op unless confirmed
    // B1: null the last_match_id back-references before deleting the match.
    db.prepare(`UPDATE ratings SET last_match_id = NULL WHERE last_match_id = ?`).run(matchId);
    db.prepare(`UPDATE overall_ratings SET last_match_id = NULL WHERE last_match_id = ?`).run(
      matchId,
    );
    db.prepare(`DELETE FROM bets WHERE match_id = ?`).run(matchId); // S1: M6-reserved, empty now
    db.prepare(`DELETE FROM match_participants WHERE match_id = ?`).run(matchId);
    db.prepare(`DELETE FROM matches WHERE id = ?`).run(matchId);
    return { status: 'ok' };
  });
  return tx.immediate();
}

export type DeleteTournamentResult = { status: 'ok' | 'not_found' };

/**
 * Delete a tournament and everything under it, reversing ELO for its confirmed
 * matches. FK-safe order (foreign_keys = ON): reverse ELO → null last_match_id →
 * delete bets → bracket_matches → match_participants → matches → admins/members →
 * tournament. One transaction. RC cups are RC-native and untouched.
 */
export function deleteTournament(
  db: Database.Database,
  tournamentId: string,
): DeleteTournamentResult {
  const tx = db.transaction((): DeleteTournamentResult => {
    const exists = db.prepare(`SELECT 1 FROM tournaments WHERE id = ?`).get(tournamentId);
    if (!exists) return { status: 'not_found' };

    // H12: capture guest members before we tear their membership down, so we can
    // purge the orphaned guest player rows afterward (else they'd linger on the
    // global leaderboard forever).
    const guestIds = (
      db
        .prepare(
          `SELECT tm.player_id FROM tournament_members tm
             JOIN players p ON p.id = tm.player_id
            WHERE tm.tournament_id = ? AND p.is_guest = 1`,
        )
        .all(tournamentId) as { player_id: string }[]
    ).map((r) => r.player_id);

    const matchIds = (
      db
        .prepare(`SELECT id FROM matches WHERE tournament_id = ?`)
        .all(tournamentId) as { id: string }[]
    ).map((r) => r.id);
    for (const id of matchIds) reverseMatchElo(db, id);

    // Subquery-based null-out / deletes while the matches still exist.
    db.prepare(
      `UPDATE ratings SET last_match_id = NULL
        WHERE last_match_id IN (SELECT id FROM matches WHERE tournament_id = ?)`,
    ).run(tournamentId);
    db.prepare(
      `UPDATE overall_ratings SET last_match_id = NULL
        WHERE last_match_id IN (SELECT id FROM matches WHERE tournament_id = ?)`,
    ).run(tournamentId);
    db.prepare(
      `DELETE FROM bets WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ?)`,
    ).run(tournamentId);
    db.prepare(`DELETE FROM bracket_matches WHERE tournament_id = ?`).run(tournamentId);
    db.prepare(
      `DELETE FROM match_participants WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ?)`,
    ).run(tournamentId);
    db.prepare(`DELETE FROM matches WHERE tournament_id = ?`).run(tournamentId);
    db.prepare(`DELETE FROM tournament_admins WHERE tournament_id = ?`).run(tournamentId);
    db.prepare(`DELETE FROM tournament_members WHERE tournament_id = ?`).run(tournamentId);
    // Now that this tournament's members + matches + bracket are gone, drop any
    // guest players who were only in this tournament.
    purgeOrphanGuests(db, guestIds);
    db.prepare(`DELETE FROM tournaments WHERE id = ?`).run(tournamentId);
    return { status: 'ok' };
  });
  return tx.immediate();
}
