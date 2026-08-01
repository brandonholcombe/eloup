import type Database from 'better-sqlite3';
import { computeMatchDeltas, type Format, type Outcome, type Participant } from '@/lib/elo';

const STARTING_RATING = 1200;
const OVERALL_K = 32;

export type ConfirmResult =
  | { status: 'pending'; remaining: number }
  | { status: 'confirmed'; deltas: Map<string, { perGame: number; overall: number }> }
  | { status: 'already_confirmed' }
  | { status: 'no_row' };

export type ForceConfirmResult =
  | { status: 'confirmed'; deltas: Map<string, { perGame: number; overall: number }> }
  | { status: 'already_confirmed' }
  | { status: 'no_match' }
  | { status: 'not_pending'; current: string };

type ParticipantRow = {
  player_id: string;
  team_label: string | null;
  placement: number | null;
  confirmed_at: string | null;
  per_game_rating: number | null;
  overall_rating: number | null;
};

type MatchRow = {
  id: string;
  game_id: string;
  status: string;
};

type GameRow = {
  id: string;
  default_k: number;
  format: Format;
};

// Admin override: fills in any unconfirmed match_participants rows with `now`
// and runs the same ELO transaction the last-confirmer path runs. Caller MUST
// have permission-checked the actor (global_admin OR tournament_admin of the
// match's tournament) — this function does not re-check authorization.
export function forceConfirmMatch(
  db: Database.Database,
  matchId: string,
  nowIso: () => string = () => new Date().toISOString(),
): ForceConfirmResult {
  const tx = db.transaction((): ForceConfirmResult => {
    const m = db.prepare(`SELECT status FROM matches WHERE id = ?`).get(matchId) as
      | { status: string }
      | undefined;
    if (!m) return { status: 'no_match' };
    if (m.status === 'confirmed') return { status: 'already_confirmed' };
    if (m.status !== 'pending') return { status: 'not_pending', current: m.status };

    db.prepare(
      `UPDATE match_participants SET confirmed_at = ? WHERE match_id = ? AND confirmed_at IS NULL`,
    ).run(nowIso(), matchId);

    const result = applyEloUpdate(db, matchId, nowIso);
    if (result.status !== 'confirmed') {
      throw new Error(
        `applyEloUpdate returned ${result.status} after force-confirm filled rows`,
      );
    }
    return result;
  });
  return tx.immediate();
}

export function confirmRow(
  db: Database.Database,
  matchId: string,
  playerId: string,
  nowIso: () => string = () => new Date().toISOString(),
): ConfirmResult {
  const tx = db.transaction((): ConfirmResult => {
    const myRow = db
      .prepare(
        `SELECT confirmed_at FROM match_participants WHERE match_id = ? AND player_id = ?`,
      )
      .get(matchId, playerId) as { confirmed_at: string | null } | undefined;
    if (!myRow) return { status: 'no_row' };
    if (myRow.confirmed_at != null) return { status: 'already_confirmed' };

    db.prepare(
      `UPDATE match_participants SET confirmed_at = ? WHERE match_id = ? AND player_id = ?`,
    ).run(nowIso(), matchId, playerId);

    const remainingRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM match_participants WHERE match_id = ? AND confirmed_at IS NULL`,
      )
      .get(matchId) as { n: number };
    if (remainingRow.n > 0) return { status: 'pending', remaining: remainingRow.n };

    return applyEloUpdate(db, matchId, nowIso);
  });
  return tx.immediate();
}

// Exported for the bracket layer (M8c recordBracketResult): runs the ELO update
// for a match whose participants already have placements + are confirmed. MUST
// be called inside an existing db.transaction() — it does not open its own.
export function applyEloUpdate(
  db: Database.Database,
  matchId: string,
  nowIso: () => string,
): ConfirmResult {
  const match = db.prepare(`SELECT id, game_id, status FROM matches WHERE id = ?`).get(matchId) as
    | MatchRow
    | undefined;
  if (!match) throw new Error(`match ${matchId} disappeared mid-transaction`);
  const game = db
    .prepare(`SELECT id, default_k, format FROM games WHERE id = ?`)
    .get(match.game_id) as GameRow | undefined;
  if (!game) throw new Error(`game ${match.game_id} missing for match ${matchId}`);

  const rows = db
    .prepare(
      `SELECT mp.player_id, mp.team_label, mp.placement, mp.confirmed_at,
              r.current_rating  AS per_game_rating,
              o.current_rating  AS overall_rating
         FROM match_participants mp
         LEFT JOIN ratings r ON r.player_id = mp.player_id AND r.game_id = ?
         LEFT JOIN overall_ratings o ON o.player_id = mp.player_id
        WHERE mp.match_id = ?`,
    )
    .all(game.id, matchId) as ParticipantRow[];

  if (rows.length === 0) throw new Error(`no participants for match ${matchId}`);

  const perGameParticipants: Participant[] = rows.map((r) => ({
    playerId: r.player_id,
    ratingBefore: r.per_game_rating ?? STARTING_RATING,
    teamLabel: r.team_label ?? undefined,
  }));
  const overallParticipants: Participant[] = rows.map((r) => ({
    playerId: r.player_id,
    ratingBefore: r.overall_rating ?? STARTING_RATING,
    teamLabel: r.team_label ?? undefined,
  }));
  const outcomes: Outcome[] = rows.map((r) => {
    if (r.placement == null) throw new Error(`participant ${r.player_id} has no placement`);
    return { playerId: r.player_id, placement: r.placement };
  });

  const perGameDeltas = computeMatchDeltas(
    perGameParticipants,
    outcomes,
    game.format,
    game.default_k,
  );
  const overallDeltas = computeMatchDeltas(overallParticipants, outcomes, game.format, OVERALL_K);

  const now = nowIso();
  const deltas = new Map<string, { perGame: number; overall: number }>();

  const upsertPerGame = db.prepare(
    // per-game ratings are intentionally NOT floored at 0 — only overall_ratings
    // is (rating.floor symbol property). Do NOT add a clamp here without updating
    // docs/rating.md + the rating symbol.
    `INSERT INTO ratings(player_id, game_id, current_rating, games_played, last_match_id)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(player_id, game_id) DO UPDATE SET
       current_rating = excluded.current_rating,
       games_played   = ratings.games_played + 1,
       last_match_id  = excluded.last_match_id`,
  );
  // escrowed_elo is reserved for M6 (Q-BET-2). It is omitted from both the
  // INSERT tuple (DEFAULT 0 fires on first insert) and the SET clause
  // (column stays untouched on conflict) so M6's bet escrow is never
  // silently overwritten by a confirm-match transaction.
  const upsertOverall = db.prepare(
    `INSERT INTO overall_ratings(player_id, current_rating, last_match_id)
     VALUES (?, MAX(0, ?), ?)
     ON CONFLICT(player_id) DO UPDATE SET
       current_rating = MAX(0, excluded.current_rating),
       last_match_id  = excluded.last_match_id`,
  );
  const updateParticipant = db.prepare(
    `UPDATE match_participants SET rating_before = ?, rating_delta = ?
      WHERE match_id = ? AND player_id = ?`,
  );

  for (const r of rows) {
    const dPerGame = perGameDeltas.get(r.player_id) ?? 0;
    const dOverall = overallDeltas.get(r.player_id) ?? 0;
    const beforePerGame = r.per_game_rating ?? STARTING_RATING;
    const beforeOverall = r.overall_rating ?? STARTING_RATING;
    const afterPerGame = beforePerGame + dPerGame;
    const afterOverall = beforeOverall + dOverall;

    updateParticipant.run(beforePerGame, dPerGame, matchId, r.player_id);
    upsertPerGame.run(r.player_id, game.id, afterPerGame, matchId);
    upsertOverall.run(r.player_id, afterOverall, matchId);

    deltas.set(r.player_id, { perGame: dPerGame, overall: dOverall });
  }

  db.prepare(
    `UPDATE matches SET status = 'confirmed', ended_at = COALESCE(ended_at, ?) WHERE id = ?`,
  ).run(now, matchId);

  return { status: 'confirmed', deltas };
}
