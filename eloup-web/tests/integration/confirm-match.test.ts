import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { confirmRow } from '@/lib/db/match';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-confirm-'));
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
  // alice (creator) confirms at submit time per Flow 3.
  db.prepare(
    `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
     VALUES ('m1', 'alice', 1, '2026-05-15T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
     VALUES ('m1', 'bob', 2, NULL)`,
  ).run();
}

describe('confirmRow — pending while not all confirmed', () => {
  it('returns pending when other rows are still unconfirmed', () => {
    const db = freshDb();
    seed(db);
    // Add a 3rd participant so bob's confirm is not the last.
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
    ).run('carol', '3', 'carol', 'Carol');
    db.prepare(
      `INSERT INTO match_participants(match_id, player_id, placement, confirmed_at)
       VALUES ('m1', 'carol', 3, NULL)`,
    ).run();
    db.prepare(`UPDATE games SET min_participants = 2, max_participants = 3 WHERE id = 'chess'`).run();
    db.prepare(`UPDATE games SET format = 'ffa' WHERE id = 'chess'`).run();

    const r = confirmRow(db, 'm1', 'bob');
    expect(r.status).toBe('pending');
    expect(db.prepare(`SELECT status FROM matches WHERE id = 'm1'`).get()).toEqual({
      status: 'pending',
    });
    db.close();
  });
});

describe('confirmRow — final confirm triggers ELO transaction', () => {
  it('flips match to confirmed, writes deltas, updates ratings', () => {
    const db = freshDb();
    seed(db);

    const r = confirmRow(db, 'm1', 'bob');
    expect(r.status).toBe('confirmed');

    const match = db.prepare(`SELECT status, ended_at FROM matches WHERE id = 'm1'`).get() as {
      status: string;
      ended_at: string | null;
    };
    expect(match.status).toBe('confirmed');
    expect(match.ended_at).not.toBeNull();

    const aliceRow = db
      .prepare(
        `SELECT rating_before, rating_delta FROM match_participants WHERE match_id = 'm1' AND player_id = 'alice'`,
      )
      .get() as { rating_before: number; rating_delta: number };
    expect(aliceRow.rating_before).toBeCloseTo(1200, 5);
    expect(aliceRow.rating_delta).toBeCloseTo(16, 5);

    const bobRow = db
      .prepare(
        `SELECT rating_before, rating_delta FROM match_participants WHERE match_id = 'm1' AND player_id = 'bob'`,
      )
      .get() as { rating_before: number; rating_delta: number };
    expect(bobRow.rating_before).toBeCloseTo(1200, 5);
    expect(bobRow.rating_delta).toBeCloseTo(-16, 5);

    const aliceRating = db
      .prepare(
        `SELECT current_rating, games_played FROM ratings WHERE player_id = 'alice' AND game_id = 'chess'`,
      )
      .get() as { current_rating: number; games_played: number };
    expect(aliceRating.current_rating).toBeCloseTo(1216, 5);
    expect(aliceRating.games_played).toBe(1);

    const aliceOverall = db
      .prepare(`SELECT current_rating FROM overall_ratings WHERE player_id = 'alice'`)
      .get() as { current_rating: number };
    expect(aliceOverall.current_rating).toBeCloseTo(1216, 5);
    db.close();
  });

  it('clamps overall_ratings at 0 when delta would push below', () => {
    const db = freshDb();
    seed(db);
    // Both at overall 10 with bob losing → bob delta = -16 → 10 + -16 = -6 → clamped to 0.
    // (If bob were the only low-rated player, his expected probability would be ~0
    // and the loss would be tiny — clamp wouldn't fire. Symmetric ratings give the
    // worst-case −K/2 hit, which is what we want for the clamp test.)
    db.prepare(
      `INSERT INTO overall_ratings(player_id, current_rating) VALUES ('alice', 10)`,
    ).run();
    db.prepare(
      `INSERT INTO overall_ratings(player_id, current_rating) VALUES ('bob', 10)`,
    ).run();
    confirmRow(db, 'm1', 'bob');
    const bobOverall = db
      .prepare(`SELECT current_rating FROM overall_ratings WHERE player_id = 'bob'`)
      .get() as { current_rating: number };
    expect(bobOverall.current_rating).toBe(0);
    db.close();
  });

  // Resolved review note 3 — explicit test for MAJOR #3.
  it('preserves escrowed_elo on upsert (M6 reserved column not overwritten)', () => {
    const db = freshDb();
    seed(db);
    db.prepare(
      `INSERT INTO overall_ratings(player_id, current_rating, escrowed_elo)
       VALUES ('alice', 1200, 50)`,
    ).run();
    db.prepare(
      `INSERT INTO overall_ratings(player_id, current_rating, escrowed_elo)
       VALUES ('bob', 1200, 75)`,
    ).run();

    const r = confirmRow(db, 'm1', 'bob');
    expect(r.status).toBe('confirmed');

    const escrows = db
      .prepare(
        `SELECT player_id, escrowed_elo FROM overall_ratings WHERE player_id IN ('alice', 'bob')`,
      )
      .all() as { player_id: string; escrowed_elo: number }[];
    const m = new Map(escrows.map((e) => [e.player_id, e.escrowed_elo]));
    expect(m.get('alice')).toBe(50);
    expect(m.get('bob')).toBe(75);
    db.close();
  });

  it('idempotent re-confirm by same player returns already_confirmed without re-running ELO', () => {
    const db = freshDb();
    seed(db);
    const first = confirmRow(db, 'm1', 'bob');
    expect(first.status).toBe('confirmed');
    const aliceRatingAfterFirst = db
      .prepare(`SELECT current_rating FROM ratings WHERE player_id = 'alice' AND game_id = 'chess'`)
      .get() as { current_rating: number };

    const second = confirmRow(db, 'm1', 'bob');
    expect(second.status).toBe('already_confirmed');
    const aliceRatingAfterSecond = db
      .prepare(`SELECT current_rating FROM ratings WHERE player_id = 'alice' AND game_id = 'chess'`)
      .get() as { current_rating: number };
    expect(aliceRatingAfterSecond.current_rating).toBe(aliceRatingAfterFirst.current_rating);
    db.close();
  });

  it('returns no_row when caller is not a participant', () => {
    const db = freshDb();
    seed(db);
    db.prepare(
      `INSERT INTO players(id, discord_id, discord_handle, display_name) VALUES (?, ?, ?, ?)`,
    ).run('eve', '99', 'eve', 'Eve');
    const r = confirmRow(db, 'm1', 'eve');
    expect(r.status).toBe('no_row');
    db.close();
  });
});
