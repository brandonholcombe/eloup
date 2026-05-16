import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { slugify, withSuffix } from '@/lib/slug';
import { createTournament } from '@/lib/tournaments';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-slug-'));
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

describe('slugify', () => {
  it('lowercases + dashes word boundaries + strips punctuation', () => {
    expect(slugify('Spring Cornhole 2026!')).toBe('spring-cornhole-2026');
  });
  it('collapses runs of separators', () => {
    expect(slugify('  Foo   ---   Bar  ')).toBe('foo-bar');
  });
  it('returns a fallback for empty / pure-punctuation input', () => {
    expect(slugify('!!!')).toBe('tournament');
    expect(slugify('')).toBe('tournament');
  });
});

describe('withSuffix', () => {
  it('returns base unchanged at attempt 1', () => {
    expect(withSuffix('spring-cornhole-2026', 1)).toBe('spring-cornhole-2026');
  });
  it('appends -N for attempt N>1', () => {
    expect(withSuffix('spring-cornhole-2026', 2)).toBe('spring-cornhole-2026-2');
    expect(withSuffix('spring-cornhole-2026', 5)).toBe('spring-cornhole-2026-5');
  });
});

describe('createTournament — slug TOCTOU collision', () => {
  it('retries on SQLITE_CONSTRAINT_UNIQUE and lands on the next suffix', () => {
    const db = freshDb();
    seedPlayer(db, 'alice');
    const first = createTournament(db, { name: 'Spring Cornhole 2026', ownerId: 'alice' });
    expect(first.slug).toBe('spring-cornhole-2026');
    const second = createTournament(db, { name: 'Spring Cornhole 2026', ownerId: 'alice' });
    expect(second.slug).toBe('spring-cornhole-2026-2');
    db.close();
  });
});
