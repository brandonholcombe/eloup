import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { bootstrapPlayer, type DiscordProfile } from '@/lib/db/players';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-bootstrap-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

const baseProfile = (id: string, opts: Partial<DiscordProfile> = {}): DiscordProfile => ({
  id,
  username: 'user_' + id,
  global_name: 'Display ' + id,
  email: `${id}@example.com`,
  verified: true,
  avatar: 'abc123',
  ...opts,
});

describe('bootstrapPlayer', () => {
  it('creates a user-role player on first login when no bootstrap env var matches', () => {
    const db = freshDb();
    const r = bootstrapPlayer(db, baseProfile('111'), undefined);
    expect(r.created).toBe(true);
    expect(r.role).toBe('user');
    expect(r.promoted).toBe(false);
    const row = db.prepare(`SELECT * FROM players WHERE discord_id = '111'`).get() as {
      role: string;
    };
    expect(row.role).toBe('user');
    db.close();
  });

  it('promotes to global_admin on first login when bootstrap env var matches', () => {
    const db = freshDb();
    const r = bootstrapPlayer(db, baseProfile('111'), '111');
    expect(r.created).toBe(true);
    expect(r.role).toBe('global_admin');
    expect(r.promoted).toBe(true);
    const row = db.prepare(`SELECT role FROM players WHERE discord_id = '111'`).get() as {
      role: string;
    };
    expect(row.role).toBe('global_admin');
    db.close();
  });

  it('idempotent: second login of an existing global_admin with same env var is a no-op', () => {
    const db = freshDb();
    bootstrapPlayer(db, baseProfile('111'), '111');
    const second = bootstrapPlayer(db, baseProfile('111'), '111');
    expect(second.created).toBe(false);
    expect(second.promoted).toBe(false);
    expect(second.role).toBe('global_admin');
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM players WHERE discord_id = '111'`)
      .get() as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });

  it('does not promote a non-matching discord id', () => {
    const db = freshDb();
    const r = bootstrapPlayer(db, baseProfile('222'), '111');
    expect(r.role).toBe('user');
    expect(r.promoted).toBe(false);
    db.close();
  });

  it('promotes an existing user-role player when env var is set later', () => {
    const db = freshDb();
    bootstrapPlayer(db, baseProfile('111'), undefined);
    const r = bootstrapPlayer(db, baseProfile('111'), '111');
    expect(r.created).toBe(false);
    expect(r.promoted).toBe(true);
    expect(r.role).toBe('global_admin');
    db.close();
  });

  it('stores avatar URL constructed from discord cdn pattern', () => {
    const db = freshDb();
    bootstrapPlayer(db, baseProfile('111', { avatar: 'hash1' }), undefined);
    const row = db
      .prepare(`SELECT avatar_url FROM players WHERE discord_id = '111'`)
      .get() as { avatar_url: string };
    expect(row.avatar_url).toBe('https://cdn.discordapp.com/avatars/111/hash1.png');
    db.close();
  });
});
