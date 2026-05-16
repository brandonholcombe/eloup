import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { confirmRow } from '@/lib/db/match';
import { createTournament } from '@/lib/tournaments';
import { getStandings } from '@/lib/tournament-standings';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-tournament-standings-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedPlayer(db: Database.Database, id: string) {
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
  ).run(id, id, id, id);
}

function seedChess(db: Database.Database) {
  db.prepare(
    `INSERT INTO games(id, name, slug, format, min_participants, max_participants, default_k)
     VALUES ('chess', 'Chess', 'chess', '1v1', 2, 2, 32)`,
  ).run();
}

function seedMember(db: Database.Database, tId: string, pId: string) {
  db.prepare(`INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`).run(
    tId,
    pId,
  );
}

function seedMatch(
  db: Database.Database,
  id: string,
  tournamentId: string | null,
  creator: string,
  winner: string,
  loser: string,
) {
  db.prepare(
    `INSERT INTO matches(id, game_id, tournament_id, created_by, status)
     VALUES (?, 'chess', ?, ?, 'pending')`,
  ).run(id, tournamentId, creator);
  db.prepare(
    `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
     VALUES (?, ?, 1, '2026-05-15T00:00:00Z')`,
  ).run(id, winner);
  db.prepare(
    `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
     VALUES (?, ?, 2, NULL)`,
  ).run(id, loser);
}

describe('tournament standings', () => {
  it('counts only tournament-scoped confirmed matches, not casual ones', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    seedPlayer(db, 'carol');
    seedChess(db);

    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    seedMember(db, t.id, 'bob');
    seedMember(db, t.id, 'carol');

    seedMatch(db, 'm-tourn', t.id, 'alice', 'alice', 'bob');
    const r1 = confirmRow(db, 'm-tourn', 'bob');
    expect(r1.status).toBe('confirmed');

    seedMatch(db, 'm-casual', null, 'alice', 'alice', 'bob');
    const r2 = confirmRow(db, 'm-casual', 'bob');
    expect(r2.status).toBe('confirmed');

    const standings = getStandings(db, t.id);
    const byPid = new Map(standings.map((r) => [r.player_id, r]));

    expect(byPid.get('alice')).toMatchObject({ wins: 1, matches_played: 1 });
    expect(byPid.get('bob')).toMatchObject({ wins: 0, matches_played: 1 });
    expect(byPid.get('carol')).toMatchObject({ wins: 0, matches_played: 0 });

    db.close();
  });

  it('ratings table reflects deltas from BOTH tournament and casual matches (Q-TOURN-2 = shared pool)', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    seedChess(db);

    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    seedMember(db, t.id, 'bob');

    seedMatch(db, 'm-tourn', t.id, 'alice', 'alice', 'bob');
    confirmRow(db, 'm-tourn', 'bob');

    const afterTournRows = db
      .prepare(`SELECT player_id, current_rating, games_played FROM ratings WHERE game_id = ?`)
      .all('chess') as Array<{ player_id: string; current_rating: number; games_played: number }>;
    const afterTourn = new Map(afterTournRows.map((r) => [r.player_id, r]));
    expect(afterTourn.get('alice')!.games_played).toBe(1);
    expect(afterTourn.get('bob')!.games_played).toBe(1);

    seedMatch(db, 'm-casual', null, 'alice', 'alice', 'bob');
    confirmRow(db, 'm-casual', 'bob');

    const afterCasualRows = db
      .prepare(`SELECT player_id, current_rating, games_played FROM ratings WHERE game_id = ?`)
      .all('chess') as Array<{ player_id: string; current_rating: number; games_played: number }>;
    const afterCasual = new Map(afterCasualRows.map((r) => [r.player_id, r]));
    expect(afterCasual.get('alice')!.games_played).toBe(2);
    expect(afterCasual.get('bob')!.games_played).toBe(2);
    expect(afterCasual.get('alice')!.current_rating).toBeGreaterThan(
      afterTourn.get('alice')!.current_rating,
    );
    db.close();
  });

  it('orders by wins desc, matches_played asc, overall_rating desc', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    seedPlayer(db, 'carol');
    seedChess(db);

    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    seedMember(db, t.id, 'bob');
    seedMember(db, t.id, 'carol');

    seedMatch(db, 'm1', t.id, 'alice', 'alice', 'bob');
    confirmRow(db, 'm1', 'bob');

    const standings = getStandings(db, t.id);
    expect(standings.map((r) => r.player_id)).toEqual(['alice', 'bob', 'carol']);
    db.close();
  });
});
