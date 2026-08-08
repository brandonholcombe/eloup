import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { forceConfirmMatch } from '@/lib/db/match';
import { createTournament } from '@/lib/tournaments';
import { createBracket, loadBracket, recordBracketResult } from '@/lib/db/bracket';
import { deleteMatch, deleteTournament } from '@/lib/db/admin-delete';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-admin-delete-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedPlayers(db: Database.Database, n: number): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `p${i}`;
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
    ).run(id, id, id, id);
    ids.push(id);
  }
  return ids;
}

function seedChess(db: Database.Database) {
  db.prepare(
    `INSERT INTO games(id, name, slug, format, min_participants, max_participants, default_k)
     VALUES ('chess', 'Chess', 'chess', '1v1', 2, 2, 32)`,
  ).run();
}

function logAndConfirm(db: Database.Database, tournamentId: string | null, winner: string, loser: string): string {
  const id = `m_${winner}_${loser}`;
  db.prepare(
    `INSERT INTO matches(id, game_id, tournament_id, created_by, status) VALUES (?, 'chess', ?, ?, 'pending')`,
  ).run(id, tournamentId, winner);
  db.prepare(`INSERT INTO match_participants(match_id, player_id, placement) VALUES (?, ?, 1)`).run(id, winner);
  db.prepare(`INSERT INTO match_participants(match_id, player_id, placement) VALUES (?, ?, 2)`).run(id, loser);
  forceConfirmMatch(db, id); // applies ELO
  return id;
}

const overall = (db: Database.Database, p: string) =>
  (db.prepare(`SELECT current_rating FROM overall_ratings WHERE player_id = ?`).get(p) as
    | { current_rating: number }
    | undefined)?.current_rating ?? 1200;
const perGame = (db: Database.Database, p: string) =>
  (db.prepare(`SELECT current_rating, games_played FROM ratings WHERE player_id = ? AND game_id = 'chess'`).get(p) as
    | { current_rating: number; games_played: number }
    | undefined) ?? { current_rating: 1200, games_played: 0 };

describe('deleteMatch reverses ELO', () => {
  it('restores per-game + overall ratings and games_played exactly (single match)', () => {
    const db = freshDb();
    const [a, b] = seedPlayers(db, 2);
    seedChess(db);
    const mid = logAndConfirm(db, null, a!, b!);
    // ELO moved
    expect(overall(db, a!)).toBeGreaterThan(1200);
    expect(overall(db, b!)).toBeLessThan(1200);
    expect(perGame(db, a!).games_played).toBe(1);

    expect(deleteMatch(db, mid).status).toBe('ok');
    // restored exactly
    expect(overall(db, a!)).toBeCloseTo(1200, 6);
    expect(overall(db, b!)).toBeCloseTo(1200, 6);
    expect(perGame(db, a!).current_rating).toBeCloseTo(1200, 6);
    expect(perGame(db, a!).games_played).toBe(0);
    // match + participants gone
    expect(db.prepare(`SELECT count(*) c FROM matches`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT count(*) c FROM match_participants`).get()).toEqual({ c: 0 });
  });

  it('reports not_found for an unknown match', () => {
    const db = freshDb();
    expect(deleteMatch(db, 'nope').status).toBe('not_found');
  });

  it('blocks deleting a bracket-linked (played) match', () => {
    const db = freshDb();
    const ps = seedPlayers(db, 8);
    const tid = createTournament(db, { name: 'Cup', ownerId: ps[0]! }).id;
    ps.forEach((p) => db.prepare(`INSERT OR IGNORE INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`).run(tid, p));
    createBracket(db, tid, ps);
    const ready = loadBracket(db, tid).nodes.find((n) => n.status === 'ready')!;
    const res = recordBracketResult(db, tid, ready.id, ready.p1!, ps[0]!);
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`);
    expect(deleteMatch(db, res.matchId!).status).toBe('bracket_linked');
  });
});

describe('deleteTournament cascades + reverses ELO', () => {
  it('removes matches/participants/bracket/members and reverses ELO (B1: FK-safe)', () => {
    const db = freshDb();
    const ps = seedPlayers(db, 4);
    seedChess(db);
    const tid = createTournament(db, { name: 'Cup', ownerId: ps[0]! }).id;
    ps.forEach((p) => db.prepare(`INSERT OR IGNORE INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`).run(tid, p));
    db.prepare(`INSERT OR IGNORE INTO tournament_admins(tournament_id, player_id) VALUES (?, ?)`).run(tid, ps[0]!);
    // a casual confirmed match in the tournament (moves ELO — and sets last_match_id, the B1 FK)
    logAndConfirm(db, tid, ps[0]!, ps[1]!);
    expect(overall(db, ps[0]!)).toBeGreaterThan(1200);

    expect(deleteTournament(db, tid).status).toBe('ok');
    // everything gone
    for (const t of ['tournaments', 'tournament_members', 'tournament_admins', 'matches', 'match_participants']) {
      expect(db.prepare(`SELECT count(*) c FROM ${t}`).get()).toEqual({ c: 0 });
    }
    // ELO reversed
    expect(overall(db, ps[0]!)).toBeCloseTo(1200, 6);
    expect(overall(db, ps[1]!)).toBeCloseTo(1200, 6);
  });

  it('reports not_found for an unknown tournament', () => {
    const db = freshDb();
    expect(deleteTournament(db, 'nope').status).toBe('not_found');
  });
});
