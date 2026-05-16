import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { checkTournamentMatchMembership, createTournament } from '@/lib/tournaments';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-membership-guard-'));
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

describe('checkTournamentMatchMembership', () => {
  it('ok when caller and every participant is a member', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    db.prepare(`INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`).run(
      t.id,
      'bob',
    );
    expect(checkTournamentMatchMembership(db, t.id, 'alice', ['alice', 'bob'])).toEqual({
      ok: true,
    });
    db.close();
  });

  it('rejects when caller is not a member', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'mallory');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    expect(
      checkTournamentMatchMembership(db, t.id, 'mallory', ['alice']),
    ).toMatchObject({ ok: false, reason: 'caller_not_member' });
    db.close();
  });

  it('rejects when a participant is not a member, naming the offender', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    expect(
      checkTournamentMatchMembership(db, t.id, 'alice', ['alice', 'bob']),
    ).toMatchObject({ ok: false, reason: 'participant_not_member', offending: 'bob' });
    db.close();
  });
});
