import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  advanceWinner,
  champion,
  generateBracket,
  type BracketNode,
} from '@/lib/bracket/engine';
import { applyEloUpdate } from '@/lib/db/match';

const SMASH_GAME_ID = 'game_smash';

type Row = {
  node_id: string;
  bracket: 'winners' | 'losers' | 'grand';
  round: number;
  position: number;
  p1_player_id: string | null;
  p2_player_id: string | null;
  p1_void: number;
  p2_void: number;
  winner_to_node: string | null;
  winner_to_slot: number | null;
  loser_to_node: string | null;
  loser_to_slot: number | null;
  status: BracketNode['status'];
  winner_player_id: string | null;
  match_id: string | null;
};

function rowToNode(r: Row): BracketNode {
  return {
    id: r.node_id,
    bracket: r.bracket,
    round: r.round,
    position: r.position,
    p1: r.p1_player_id,
    p2: r.p2_player_id,
    p1Void: !!r.p1_void,
    p2Void: !!r.p2_void,
    winnerTo: r.winner_to_node ? { id: r.winner_to_node, slot: (r.winner_to_slot as 1 | 2) } : null,
    loserTo: r.loser_to_node ? { id: r.loser_to_node, slot: (r.loser_to_slot as 1 | 2) } : null,
    status: r.status,
    winner: r.winner_player_id,
  };
}

/** Tournament members ordered by overall ELO desc (default bracket seeding). */
export function seedMembersByElo(db: Database.Database, tournamentId: string): string[] {
  return (
    db
      .prepare(
        `SELECT tm.player_id
           FROM tournament_members tm
           LEFT JOIN overall_ratings o ON o.player_id = tm.player_id
          WHERE tm.tournament_id = ?
          ORDER BY COALESCE(o.current_rating, 1200) DESC, tm.player_id`,
      )
      .all(tournamentId) as { player_id: string }[]
  ).map((r) => r.player_id);
}

export function bracketExists(db: Database.Database, tournamentId: string): boolean {
  const r = db
    .prepare(`SELECT 1 FROM bracket_matches WHERE tournament_id = ? LIMIT 1`)
    .get(tournamentId);
  return !!r;
}

/** Load a tournament's bracket as engine nodes (+ per-node match_id side map). */
export function loadBracket(
  db: Database.Database,
  tournamentId: string,
): { nodes: BracketNode[]; matchIdByNode: Map<string, string | null> } {
  const rows = db
    .prepare(
      `SELECT node_id, bracket, round, position, p1_player_id, p2_player_id,
              p1_void, p2_void, winner_to_node, winner_to_slot, loser_to_node,
              loser_to_slot, status, winner_player_id, match_id
         FROM bracket_matches WHERE tournament_id = ?`,
    )
    .all(tournamentId) as Row[];
  return {
    nodes: rows.map(rowToNode),
    matchIdByNode: new Map(rows.map((r) => [r.node_id, r.match_id])),
  };
}

/**
 * Generate + persist a double-elim bracket for the given players (seed-rank
 * order, best first) and mark the tournament format. Idempotent guard: throws if
 * a bracket already exists (regenerate = delete first). Runs in one transaction.
 */
export function createBracket(
  db: Database.Database,
  tournamentId: string,
  playersBySeedRank: string[],
): void {
  const tx = db.transaction(() => {
    if (bracketExists(db, tournamentId)) throw new Error('bracket already exists');
    const nodes = generateBracket(playersBySeedRank);
    const ins = db.prepare(
      `INSERT INTO bracket_matches(
         tournament_id, node_id, bracket, round, position, p1_player_id, p2_player_id,
         p1_void, p2_void, winner_to_node, winner_to_slot, loser_to_node, loser_to_slot,
         status, winner_player_id, match_id)
       VALUES (@tid,@node,@bracket,@round,@position,@p1,@p2,@p1v,@p2v,@wto,@wslot,@lto,@lslot,@status,@winner,NULL)`,
    );
    for (const n of nodes) {
      ins.run({
        tid: tournamentId,
        node: n.id,
        bracket: n.bracket,
        round: n.round,
        position: n.position,
        p1: n.p1,
        p2: n.p2,
        p1v: n.p1Void ? 1 : 0,
        p2v: n.p2Void ? 1 : 0,
        wto: n.winnerTo?.id ?? null,
        wslot: n.winnerTo?.slot ?? null,
        lto: n.loserTo?.id ?? null,
        lslot: n.loserTo?.slot ?? null,
        status: n.status,
        winner: n.winner,
      });
    }
    db.prepare(`UPDATE tournaments SET format = 'double_elim' WHERE id = ?`).run(tournamentId);
  });
  tx.immediate();
}

/** Write back the mutable columns of each node (routing is immutable). */
function persistNodes(db: Database.Database, tournamentId: string, nodes: BracketNode[]): void {
  const upd = db.prepare(
    `UPDATE bracket_matches
        SET p1_player_id = @p1, p2_player_id = @p2, p1_void = @p1v, p2_void = @p2v,
            status = @status, winner_player_id = @winner
      WHERE tournament_id = @tid AND node_id = @node`,
  );
  for (const n of nodes) {
    upd.run({
      tid: tournamentId,
      node: n.id,
      p1: n.p1,
      p2: n.p2,
      p1v: n.p1Void ? 1 : 0,
      p2v: n.p2Void ? 1 : 0,
      status: n.status,
      winner: n.winner,
    });
  }
}

export type ReportResult =
  | { status: 'ok'; matchId: string | null; champion: string | null }
  | { status: 'no_node' }
  | { status: 'not_ready' }
  | { status: 'bad_winner' };

/**
 * Record a PLAYED bracket result (admin-authoritative, S5): in ONE transaction,
 * create a real Smash matches row (winner placement 1, loser 2, pre-confirmed),
 * run the ELO update, advance the bracket, and persist. Feeds per-game + overall
 * ELO (shared-ELO decision).
 */
export function recordBracketResult(
  db: Database.Database,
  tournamentId: string,
  nodeId: string,
  winnerId: string,
  createdBy: string,
  nowIso: () => string = () => new Date().toISOString(),
): ReportResult {
  const tx = db.transaction((): ReportResult => {
    const { nodes } = loadBracket(db, tournamentId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return { status: 'no_node' };
    if (node.status !== 'ready') return { status: 'not_ready' };
    if (winnerId !== node.p1 && winnerId !== node.p2) return { status: 'bad_winner' };
    const loserId = winnerId === node.p1 ? node.p2! : node.p1!;

    const now = nowIso();
    const matchId = randomUUID();
    db.prepare(
      `INSERT INTO matches(id, game_id, tournament_id, created_by, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(matchId, SMASH_GAME_ID, tournamentId, createdBy, now);
    const insP = db.prepare(
      `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
       VALUES (?, ?, ?, ?)`,
    );
    insP.run(matchId, winnerId, 1, now);
    insP.run(matchId, loserId, 2, now);
    // Runs ELO + marks the match confirmed (we are inside this transaction).
    applyEloUpdate(db, matchId, nowIso);

    advanceWinner(nodes, nodeId, winnerId);
    persistNodes(db, tournamentId, nodes);
    db.prepare(
      `UPDATE bracket_matches SET match_id = ? WHERE tournament_id = ? AND node_id = ?`,
    ).run(matchId, tournamentId, nodeId);

    return { status: 'ok', matchId, champion: champion(nodes) };
  });
  return tx.immediate();
}

/**
 * Record a WALKOVER / no-show (S6): advance the winner with NO matches row and
 * NO ELO — for a mid-bracket no-show, distinct from a played result.
 */
export function recordWalkover(
  db: Database.Database,
  tournamentId: string,
  nodeId: string,
  winnerId: string,
): ReportResult {
  const tx = db.transaction((): ReportResult => {
    const { nodes } = loadBracket(db, tournamentId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return { status: 'no_node' };
    if (node.status !== 'ready') return { status: 'not_ready' };
    if (winnerId !== node.p1 && winnerId !== node.p2) return { status: 'bad_winner' };
    advanceWinner(nodes, nodeId, winnerId);
    persistNodes(db, tournamentId, nodes);
    return { status: 'ok', matchId: null, champion: champion(nodes) };
  });
  return tx.immediate();
}
