import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import {
  playerCategoryRatings,
  playerGameRatings,
  searchPlayers,
} from '@/lib/db/queries';

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

function seedGame(
  db: Database.Database,
  id: string,
  name: string,
  category: string,
) {
  db.prepare(
    `INSERT INTO games(id, name, slug, format, min_participants, max_participants, default_k, category)
     VALUES (?, ?, ?, '1v1', 2, 2, 32, ?)`,
  ).run(id, name, id, category);
}

function seedRating(
  db: Database.Database,
  playerId: string,
  gameId: string,
  currentRating: number,
  gamesPlayed: number,
) {
  db.prepare(
    `INSERT INTO ratings(player_id, game_id, current_rating, games_played)
     VALUES (?, ?, ?, ?)`,
  ).run(playerId, gameId, currentRating, gamesPlayed);
}

describe('playerCategoryRatings', () => {
  it('weighted-average of 1300×10g + 1500×4g = 19000/14 → 1357', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'p1', 'P1');
    seedGame(db, 'rr1', 'RR1', 'racing');
    seedGame(db, 'rr2', 'RR2', 'racing');
    seedRating(db, 'p1', 'rr1', 1300, 10);
    seedRating(db, 'p1', 'rr2', 1500, 4);

    const rows = playerCategoryRatings(db, 'p1');
    expect(rows.length).toBe(1);
    expect(rows[0]!.category).toBe('racing');
    // CAST(ROUND(19000 / 14) AS INTEGER) = ROUND(1357.142...) = 1357.
    expect(rows[0]!.weightedRating).toBe(1357);
    expect(rows[0]!.gameCount).toBe(2);
    expect(rows[0]!.totalMatches).toBe(14);
  });

  it('excludes zero-match ratings rows from the rollup', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'p1', 'P1');
    seedGame(db, 'corn', 'Cornhole', 'yard');
    seedGame(db, 'kj', 'KanJam', 'yard');
    seedRating(db, 'p1', 'corn', 1400, 5);
    seedRating(db, 'p1', 'kj', 1200, 0);

    const rows = playerCategoryRatings(db, 'p1');
    // Only Cornhole counts toward yard; KanJam is filtered.
    expect(rows.length).toBe(1);
    expect(rows[0]!.category).toBe('yard');
    expect(rows[0]!.weightedRating).toBe(1400);
    expect(rows[0]!.gameCount).toBe(1);
    expect(rows[0]!.totalMatches).toBe(5);
  });

  it('SQLite ROUND(1350.5) rounds half away from zero → 1351', () => {
    // Pins SQLite's actual ROUND behavior on .5 ties. better-sqlite3's
    // bundled SQLite uses half-away-from-zero (not banker's even), so
    // ROUND(1350.5) = 1351, matching JS Math.round(1350.5) = 1351.
    // This guards against a future swap of the SQL rollup to a different
    // rounding mode or a SQLite upstream behavior change.
    const db = freshDb();
    seedPlayer(db, 'p1', 'p1', 'P1');
    seedGame(db, 'g1', 'G1', 'bar');
    seedRating(db, 'p1', 'g1', 1350.5, 1);
    const rows = playerCategoryRatings(db, 'p1');
    expect(rows[0]!.weightedRating).toBe(1351);
  });

  it('orders rows by weighted rating DESC', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'p1', 'P1');
    seedGame(db, 'g-bar', 'Bar', 'bar');
    seedGame(db, 'g-yard', 'Yard', 'yard');
    seedGame(db, 'g-racing', 'Racing', 'racing');
    seedRating(db, 'p1', 'g-bar', 1300, 1);
    seedRating(db, 'p1', 'g-yard', 1400, 1);
    seedRating(db, 'p1', 'g-racing', 1100, 1);

    const rows = playerCategoryRatings(db, 'p1');
    expect(rows.map((r) => r.weightedRating)).toEqual([1400, 1300, 1100]);
    expect(rows.map((r) => r.category)).toEqual(['yard', 'bar', 'racing']);
  });

  it('returns empty array for a player with no ratings rows', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'p1', 'P1');
    expect(playerCategoryRatings(db, 'p1')).toEqual([]);
  });
});

describe('playerGameRatings', () => {
  it('returns per-game rows ordered by category then game name (zero-match included)', () => {
    const db = freshDb();
    seedPlayer(db, 'p1', 'p1', 'P1');
    seedGame(db, 'kj', 'KanJam', 'yard');
    seedGame(db, 'corn', 'Cornhole', 'yard');
    seedGame(db, 'pool', 'Pool', 'bar');
    seedRating(db, 'p1', 'kj', 1200, 0);
    seedRating(db, 'p1', 'corn', 1400, 5);
    seedRating(db, 'p1', 'pool', 1350, 8);

    const rows = playerGameRatings(db, 'p1');
    // ORDER BY category, name → bar/Pool, yard/Cornhole, yard/KanJam.
    expect(rows.map((r) => r.gameName)).toEqual(['Pool', 'Cornhole', 'KanJam']);
    expect(rows.map((r) => r.category)).toEqual(['bar', 'yard', 'yard']);
    // KanJam has games_played = 0 but appears here — see comment in
    // playerCategoryRatings; the rollup excludes zero-match, this list
    // includes it.
    const kj = rows.find((r) => r.gameName === 'KanJam')!;
    expect(kj.gamesPlayed).toBe(0);
  });
});
