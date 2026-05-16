import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { forceConfirmMatch } from '@/lib/db/match';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-force-confirm-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seed(db: Database.Database) {
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
  ).run('alice', '1', 'alice', 'Alice');
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
  ).run('bob', '2', 'bob', 'Bob');
  db.prepare(
    `INSERT INTO games(id, name, slug, format, min_participants, max_participants, default_k)
     VALUES ('chess', 'Chess', 'chess', '1v1', 2, 2, 32)`,
  ).run();
  db.prepare(
    `INSERT INTO matches(id, game_id, created_by, status) VALUES ('m1', 'chess', 'alice', 'pending')`,
  ).run();
  db.prepare(
    `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
     VALUES ('m1', 'alice', 1, '2026-05-15T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
     VALUES ('m1', 'bob', 2, NULL)`,
  ).run();
}

describe('forceConfirmMatch — admin override', () => {
  it('fills unconfirmed rows and runs ELO transaction', () => {
    const db = freshDb();
    seed(db);

    const r = forceConfirmMatch(db, 'm1');
    expect(r.status).toBe('confirmed');

    const match = db.prepare(`SELECT status, ended_at FROM matches WHERE id = 'm1'`).get() as {
      status: string;
      ended_at: string | null;
    };
    expect(match.status).toBe('confirmed');
    expect(match.ended_at).not.toBeNull();

    const rows = db
      .prepare(
        `SELECT player_id, confirmed_at, rating_before, rating_delta FROM match_participants WHERE match_id = 'm1' ORDER BY placement`,
      )
      .all() as Array<{
      player_id: string;
      confirmed_at: string | null;
      rating_before: number | null;
      rating_delta: number | null;
    }>;
    expect(rows.every((r) => r.confirmed_at != null)).toBe(true);
    expect(rows.every((r) => r.rating_before != null && r.rating_delta != null)).toBe(true);

    const ratings = db.prepare(`SELECT player_id, current_rating FROM ratings`).all() as Array<{
      player_id: string;
      current_rating: number;
    }>;
    expect(ratings).toHaveLength(2);

    const overall = db.prepare(`SELECT player_id, current_rating FROM overall_ratings`).all();
    expect(overall).toHaveLength(2);

    db.close();
  });

  it('returns already_confirmed when status is already confirmed', () => {
    const db = freshDb();
    seed(db);
    db.prepare(`UPDATE matches SET status = 'confirmed' WHERE id = 'm1'`).run();

    const r = forceConfirmMatch(db, 'm1');
    expect(r.status).toBe('already_confirmed');
    db.close();
  });

  it('returns no_match for unknown id', () => {
    const db = freshDb();
    seed(db);
    const r = forceConfirmMatch(db, 'does-not-exist');
    expect(r.status).toBe('no_match');
    db.close();
  });

  it('returns not_pending for disputed match', () => {
    const db = freshDb();
    seed(db);
    db.prepare(`UPDATE matches SET status = 'disputed' WHERE id = 'm1'`).run();
    const r = forceConfirmMatch(db, 'm1');
    expect(r.status).toBe('not_pending');
    if (r.status === 'not_pending') expect(r.current).toBe('disputed');
    db.close();
  });

  it('is idempotent on a fully-confirmed match (no double ELO)', () => {
    const db = freshDb();
    seed(db);

    forceConfirmMatch(db, 'm1');
    const ratingBefore = db.prepare(`SELECT current_rating FROM ratings WHERE player_id = 'alice'`).get() as {
      current_rating: number;
    };

    const r2 = forceConfirmMatch(db, 'm1');
    expect(r2.status).toBe('already_confirmed');

    const ratingAfter = db.prepare(`SELECT current_rating FROM ratings WHERE player_id = 'alice'`).get() as {
      current_rating: number;
    };
    expect(ratingAfter.current_rating).toBe(ratingBefore.current_rating);
    db.close();
  });
});
