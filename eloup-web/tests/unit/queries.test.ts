import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { searchPlayers } from '@/lib/db/queries';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-queries-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedPlayer(
  db: Database.Database,
  id: string,
  handle: string,
  displayName: string,
) {
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES (?, ?, ?, ?, 'user')`,
  ).run(id, `discord-${id}`, handle, displayName);
}

describe('searchPlayers', () => {
  it('matches by display_name substring', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'brandonw', 'Brandon');
    seedPlayer(db, 'p2', 'willyz', 'William');
    seedPlayer(db, 'p3', 'someoneelse', 'Someone Else');

    const hits = searchPlayers(db, 'bran');
    expect(hits.map((h) => h.id)).toEqual(['p1']);
  });

  it('matches by discord_handle substring', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'brandonw', 'Brandon');
    seedPlayer(db, 'p2', 'willyz', 'William');

    const hits = searchPlayers(db, 'will');
    expect(hits.map((h) => h.id).sort()).toEqual(['p2']);
  });

  it('is case-insensitive on both display_name and handle', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'brandonw', 'Brandon');

    expect(searchPlayers(db, 'BRAN').map((h) => h.id)).toEqual(['p1']);
    expect(searchPlayers(db, 'BRANDONW').map((h) => h.id)).toEqual(['p1']);
  });

  it('caps results at the provided limit (default 5, max passed)', () => {
    const db = freshDb();
    for (let i = 0; i < 20; i++) {
      seedPlayer(db, `p${i}`, `match${i}`, `Match ${i}`);
    }
    expect(searchPlayers(db, 'match').length).toBe(5);
    expect(searchPlayers(db, 'match', 10).length).toBe(10);
    expect(searchPlayers(db, 'match', 20).length).toBe(20);
  });

  it('returns [] for an empty / whitespace-only query', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'brandonw', 'Brandon');

    expect(searchPlayers(db, '')).toEqual([]);
    expect(searchPlayers(db, '   ')).toEqual([]);
  });

  it('returns [] when there are no matches', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'brandonw', 'Brandon');
    expect(searchPlayers(db, 'zzzzz')).toEqual([]);
  });

  it('escapes LIKE metacharacters — underscore in query matches only literal underscore', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'user_name', 'Real User');
    seedPlayer(db, 'p2', 'userXname', 'Other User');
    seedPlayer(db, 'p3', 'userYname', 'Yet Another');

    // Without ESCAPE handling, `user_name` LIKE-pattern would match
    // userXname / userYname too (underscore is a wildcard). With our
    // escape, only the literal user_name matches.
    const hits = searchPlayers(db, 'user_name');
    expect(hits.map((h) => h.id)).toEqual(['p1']);
  });

  it('escapes LIKE metacharacters — percent in query matches only literal percent', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', '50%off', 'Discount');
    seedPlayer(db, 'p2', '50pctoff', 'Other');

    const hits = searchPlayers(db, '50%off');
    expect(hits.map((h) => h.id)).toEqual(['p1']);
  });
});
