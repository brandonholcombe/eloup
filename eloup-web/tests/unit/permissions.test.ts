import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import {
  canConfirmRow,
  canCreateGame,
  canEditMatch,
  isTournamentAdmin,
  isTournamentMember,
} from '@/lib/permissions';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-perm-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedPlayer(db: Database.Database, id: string, role: 'user' | 'global_admin' = 'user') {
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, id, id, id, role);
}

function seedGame(db: Database.Database, id: string) {
  db.prepare(
    `INSERT INTO games(id, name, slug, format, min_participants, max_participants)
     VALUES (?, ?, ?, '1v1', 2, 2)`,
  ).run(id, id, id);
}

function seedMatch(db: Database.Database, matchId: string, gameId: string, createdBy: string) {
  db.prepare(
    `INSERT INTO matches(id, game_id, created_by, status) VALUES (?, ?, ?, 'pending')`,
  ).run(matchId, gameId, createdBy);
}

function seedRow(
  db: Database.Database,
  matchId: string,
  playerId: string,
  confirmedAt: string | null,
) {
  db.prepare(
    `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
     VALUES (?, ?, 1, ?)`,
  ).run(matchId, playerId, confirmedAt);
}

function seedTournament(db: Database.Database, id: string, ownerId: string) {
  db.prepare(
    `INSERT INTO tournaments(id, name, slug, owner_id, format) VALUES (?, ?, ?, ?, 'named_group')`,
  ).run(id, id, id, ownerId);
}

function seedTournamentMember(db: Database.Database, tournamentId: string, playerId: string) {
  db.prepare(
    `INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`,
  ).run(tournamentId, playerId);
}

function seedTournamentAdmin(db: Database.Database, tournamentId: string, playerId: string) {
  db.prepare(
    `INSERT INTO tournament_admins(tournament_id, player_id) VALUES (?, ?)`,
  ).run(tournamentId, playerId);
}

describe('canCreateGame', () => {
  it('global_admin → true', () => {
    expect(canCreateGame({ id: 'a', role: 'global_admin' })).toBe(true);
  });
  it('user → false', () => {
    expect(canCreateGame({ id: 'a', role: 'user' })).toBe(false);
  });
  it('null → false', () => {
    expect(canCreateGame(null)).toBe(false);
  });
});

describe('canEditMatch', () => {
  it('global_admin can edit any match', () => {
    const db = freshDb();
    expect(
      canEditMatch(db, { id: 'admin', role: 'global_admin' }, {
        created_by: 'someone-else',
        tournament_id: null,
      }),
    ).toBe(true);
    db.close();
  });
  it('creator can edit own match', () => {
    const db = freshDb();
    expect(
      canEditMatch(db, { id: 'a', role: 'user' }, { created_by: 'a', tournament_id: null }),
    ).toBe(true);
    db.close();
  });
  it('user cannot edit other users matches', () => {
    const db = freshDb();
    expect(
      canEditMatch(db, { id: 'a', role: 'user' }, { created_by: 'b', tournament_id: null }),
    ).toBe(false);
    db.close();
  });
  it('tournament admin can edit a match scoped to their tournament', () => {
    const db = freshDb();
    seedPlayer(db, 'admin');
    seedPlayer(db, 'creator');
    seedTournament(db, 't1', 'creator');
    seedTournamentAdmin(db, 't1', 'admin');
    expect(
      canEditMatch(db, { id: 'admin', role: 'user' }, {
        created_by: 'creator',
        tournament_id: 't1',
      }),
    ).toBe(true);
    db.close();
  });
  it('tournament admin cannot edit a match scoped to a different tournament', () => {
    const db = freshDb();
    seedPlayer(db, 'admin');
    seedPlayer(db, 'creator');
    seedTournament(db, 't1', 'creator');
    seedTournament(db, 't2', 'creator');
    seedTournamentAdmin(db, 't1', 'admin');
    expect(
      canEditMatch(db, { id: 'admin', role: 'user' }, {
        created_by: 'creator',
        tournament_id: 't2',
      }),
    ).toBe(false);
    db.close();
  });
});

describe('isTournamentMember', () => {
  it('true when the membership row exists', () => {
    const db = freshDb();
    seedPlayer(db, 'a');
    seedTournament(db, 't1', 'a');
    seedTournamentMember(db, 't1', 'a');
    expect(isTournamentMember(db, 'a', 't1')).toBe(true);
    db.close();
  });
  it('false when no row exists', () => {
    const db = freshDb();
    seedPlayer(db, 'a');
    seedPlayer(db, 'b');
    seedTournament(db, 't1', 'a');
    expect(isTournamentMember(db, 'b', 't1')).toBe(false);
    db.close();
  });
});

describe('isTournamentAdmin', () => {
  it('true when in tournament_admins', () => {
    const db = freshDb();
    seedPlayer(db, 'a');
    seedTournament(db, 't1', 'a');
    seedTournamentAdmin(db, 't1', 'a');
    expect(isTournamentAdmin(db, { id: 'a', role: 'user' }, 't1')).toBe(true);
    db.close();
  });
  it('true for any global_admin regardless of row presence', () => {
    const db = freshDb();
    seedPlayer(db, 'admin', 'global_admin');
    seedPlayer(db, 'creator');
    seedTournament(db, 't1', 'creator');
    expect(isTournamentAdmin(db, { id: 'admin', role: 'global_admin' }, 't1')).toBe(true);
    db.close();
  });
  it('false for a member who is not an admin', () => {
    const db = freshDb();
    seedPlayer(db, 'a');
    seedPlayer(db, 'b');
    seedTournament(db, 't1', 'a');
    seedTournamentMember(db, 't1', 'b');
    expect(isTournamentAdmin(db, { id: 'b', role: 'user' }, 't1')).toBe(false);
    db.close();
  });
  it('false for a null session', () => {
    const db = freshDb();
    expect(isTournamentAdmin(db, null, 't1')).toBe(false);
    db.close();
  });
});

describe('canConfirmRow', () => {
  it('returns true if own row exists and is unconfirmed', () => {
    const db = freshDb();
    seedPlayer(db, 'a');
    seedGame(db, 'g');
    seedMatch(db, 'm', 'g', 'a');
    seedRow(db, 'm', 'a', null);
    expect(canConfirmRow(db, { id: 'a', role: 'user' }, 'm')).toBe(true);
    db.close();
  });

  it('returns false if row is already confirmed (idempotent guard)', () => {
    const db = freshDb();
    seedPlayer(db, 'a');
    seedGame(db, 'g');
    seedMatch(db, 'm', 'g', 'a');
    seedRow(db, 'm', 'a', '2026-05-15T00:00:00Z');
    expect(canConfirmRow(db, { id: 'a', role: 'user' }, 'm')).toBe(false);
    db.close();
  });

  it('returns false if no row exists for caller', () => {
    const db = freshDb();
    seedPlayer(db, 'a');
    seedPlayer(db, 'b');
    seedGame(db, 'g');
    seedMatch(db, 'm', 'g', 'a');
    seedRow(db, 'm', 'a', null);
    expect(canConfirmRow(db, { id: 'b', role: 'user' }, 'm')).toBe(false);
    db.close();
  });

  it('returns false for anonymous (null) session', () => {
    const db = freshDb();
    expect(canConfirmRow(db, null, 'm')).toBe(false);
    db.close();
  });
});
