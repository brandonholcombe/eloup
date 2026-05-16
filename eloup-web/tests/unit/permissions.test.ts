import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { canConfirmRow, canCreateGame, canEditMatch } from '@/lib/permissions';

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
    expect(canEditMatch({ id: 'admin', role: 'global_admin' }, 'someone-else')).toBe(true);
  });
  it('creator can edit own match', () => {
    expect(canEditMatch({ id: 'a', role: 'user' }, 'a')).toBe(true);
  });
  it('user cannot edit other users matches', () => {
    expect(canEditMatch({ id: 'a', role: 'user' }, 'b')).toBe(false);
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
