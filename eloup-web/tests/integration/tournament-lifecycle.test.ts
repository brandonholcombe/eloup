import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import {
  createTournament,
  promoteToAdmin,
  demoteFromAdmin,
  removeMember,
  listMembers,
  CreatorImmutableError,
  NotAMemberError,
} from '@/lib/tournaments';
import {
  buildJoinResponse,
  consumeInvite,
  issueInvite,
  revokeInvite,
} from '@/lib/invites';

// Minimal env so lib/env's zod schema succeeds when buildJoinResponse calls
// env() to look up APP_DOMAIN for the post-join redirect. Must run before
// any env() call. Mutating process.env directly is fine because each test
// file runs in its own vitest fork worker.
process.env.DISCORD_CLIENT_ID ??= 'test-client-id';
process.env.DISCORD_CLIENT_SECRET ??= 'test-client-secret';
process.env.APP_SESSION_SECRET ??= 'x'.repeat(43);
process.env.APP_DOMAIN ??= 'https://eloup.kodloki.io';
process.env.DATABASE_PATH ??= '/tmp/eloup-tournament-lifecycle.sqlite';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-tournament-lifecycle-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedPlayer(db: Database.Database, id: string, role: 'user' | 'global_admin' = 'user') {
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, id, id, id, role);
}

describe('createTournament', () => {
  it('inserts the row and seeds creator into admins + members', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    const t = createTournament(db, { name: 'Spring Cornhole', ownerId: 'alice' });
    expect(t.slug).toBe('spring-cornhole');
    expect(t.format).toBe('named_group');
    expect(t.owner_id).toBe('alice');
    const admins = db
      .prepare(`SELECT player_id FROM tournament_admins WHERE tournament_id = ?`)
      .all(t.id);
    const members = db
      .prepare(`SELECT player_id FROM tournament_members WHERE tournament_id = ?`)
      .all(t.id);
    expect(admins).toEqual([{ player_id: 'alice' }]);
    expect(members).toEqual([{ player_id: 'alice' }]);
    db.close();
  });
});

describe('invite lifecycle', () => {
  it('issues a URL-safe token of at least 20 chars and writes it to the row', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    const { token } = issueInvite(db, t.id);
    expect(token.length).toBeGreaterThanOrEqual(20);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const row = db
      .prepare(`SELECT invite_token FROM tournaments WHERE id = ?`)
      .get(t.id) as { invite_token: string };
    expect(row.invite_token).toBe(token);
    db.close();
  });

  it('consume adds membership and is idempotent on a repeat call', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    const { token } = issueInvite(db, t.id);

    const first = consumeInvite(db, token, 'bob');
    expect(first.status).toBe('joined');

    const second = consumeInvite(db, token, 'bob');
    expect(second.status).toBe('already_member');

    const rows = db
      .prepare(`SELECT player_id FROM tournament_members WHERE tournament_id = ?`)
      .all(t.id);
    expect(rows).toHaveLength(2);
    db.close();
  });

  it('revoke clears the token; future consume returns invalid_token', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    const { token } = issueInvite(db, t.id);
    expect(revokeInvite(db, t.id)).toEqual({ revoked: true });
    expect(consumeInvite(db, token, 'bob').status).toBe('invalid_token');
    db.close();
  });

  it('join URL on a revoked token returns HTTP 410 and does not insert a membership row', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    const { token } = issueInvite(db, t.id);
    revokeInvite(db, t.id);

    const memberCountBefore = (
      db.prepare(`SELECT COUNT(*) AS n FROM tournament_members WHERE tournament_id = ?`).get(t.id) as { n: number }
    ).n;

    const result = consumeInvite(db, token, 'bob');
    const response = buildJoinResponse(result);
    expect(response.status).toBe(410);

    const memberCountAfter = (
      db.prepare(`SELECT COUNT(*) AS n FROM tournament_members WHERE tournament_id = ?`).get(t.id) as { n: number }
    ).n;
    expect(memberCountAfter).toBe(memberCountBefore);
    db.close();
  });

  it('join URL on a valid token returns a 303 redirect to the tournament detail page', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    const { token } = issueInvite(db, t.id);
    const result = consumeInvite(db, token, 'bob');
    const response = buildJoinResponse(result);
    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    // Regression guard: the redirect host MUST be APP_DOMAIN's host, never the
    // server bind interface (0.0.0.0:3000). M5 originally built `target` from
    // `req.url`, which Next.js populates from the bind interface in-cluster.
    expect(new URL(location).host).toBe('eloup.kodloki.io');
    expect(location).toBe(`https://eloup.kodloki.io/tournaments/${t.slug}`);
    db.close();
  });

  it('rotate replaces the prior token; the prior token becomes invalid', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    const first = issueInvite(db, t.id).token;
    const second = issueInvite(db, t.id).token;
    expect(second).not.toBe(first);
    expect(consumeInvite(db, first, 'bob').status).toBe('invalid_token');
    expect(consumeInvite(db, second, 'bob').status).toBe('joined');
    db.close();
  });
});

describe('promote / demote / remove', () => {
  it('promote upserts a tournament_admins row; idempotent on repeat', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    db.prepare(`INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`).run(
      t.id,
      'bob',
    );
    expect(promoteToAdmin(db, t.id, 'bob')).toEqual({ promoted: true });
    expect(promoteToAdmin(db, t.id, 'bob')).toEqual({ promoted: false });
    db.close();
  });

  it('promote rejects a non-member', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    expect(() => promoteToAdmin(db, t.id, 'bob')).toThrow(NotAMemberError);
    db.close();
  });

  it('demote removes the tournament_admins row', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    db.prepare(`INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`).run(
      t.id,
      'bob',
    );
    promoteToAdmin(db, t.id, 'bob');
    expect(demoteFromAdmin(db, t.id, 'bob', 'user')).toEqual({ demoted: true });
    expect(demoteFromAdmin(db, t.id, 'bob', 'user')).toEqual({ demoted: false });
    db.close();
  });

  it('demote rejects the creator unless caller is a global_admin', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    expect(() => demoteFromAdmin(db, t.id, 'alice', 'user')).toThrow(CreatorImmutableError);
    expect(demoteFromAdmin(db, t.id, 'alice', 'global_admin')).toEqual({ demoted: true });
    db.close();
  });

  it('removeMember drops both the membership and the admin row', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    seedPlayer(db, 'bob');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    db.prepare(`INSERT INTO tournament_members(tournament_id, player_id) VALUES (?, ?)`).run(
      t.id,
      'bob',
    );
    promoteToAdmin(db, t.id, 'bob');
    expect(removeMember(db, t.id, 'bob')).toEqual({ removed: true });
    const members = listMembers(db, t.id).map((m) => m.player_id);
    expect(members).toEqual(['alice']);
    const adminRows = db
      .prepare(`SELECT 1 FROM tournament_admins WHERE tournament_id = ? AND player_id = ?`)
      .all(t.id, 'bob');
    expect(adminRows).toHaveLength(0);
    db.close();
  });

  it('removeMember rejects the creator', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    const t = createTournament(db, { name: 'T1', ownerId: 'alice' });
    expect(() => removeMember(db, t.id, 'alice')).toThrow(CreatorImmutableError);
    db.close();
  });
});
