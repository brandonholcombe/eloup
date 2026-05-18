import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';
import { createTrack } from '@/lib/rc/tracks';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-rc-tracks-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

describe('createTrack', () => {
  it('inserts a new track with a slugified name', () => {
    const db = freshDb();
    const res = createTrack(db, 'Outdoor Long');
    expect(res.matched).toBe(false);
    const row = db.prepare(`SELECT name, slug FROM rc_tracks WHERE id = ?`).get(res.trackId) as {
      name: string;
      slug: string;
    };
    expect(row.name).toBe('Outdoor Long');
    expect(row.slug).toBe('outdoor-long');
  });

  it('case-insensitive name match short-circuits — no new row', () => {
    const db = freshDb();
    const first = createTrack(db, 'Outdoor Long');
    const second = createTrack(db, 'outdoor long');
    expect(second.matched).toBe(true);
    expect(second.trackId).toBe(first.trackId);
    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM rc_tracks`).get() as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  it('slug collision (names that slugify identically) gets a numeric suffix', () => {
    const db = freshDb();
    const first = createTrack(db, 'Outdoor Long');
    // Different name (so the case-insensitive short-circuit misses), but
    // slugify('Outdoor Long!') === 'outdoor-long' too.
    const second = createTrack(db, 'Outdoor Long!');
    expect(second.matched).toBe(false);
    expect(second.trackId).not.toBe(first.trackId);

    const slugs = (
      db.prepare(`SELECT slug FROM rc_tracks ORDER BY slug`).all() as { slug: string }[]
    ).map((r) => r.slug);
    expect(slugs).toEqual(['outdoor-long', 'outdoor-long-2']);
  });

  it('blank-ish name falls back to slugify default', () => {
    // slugify('!!!') returns its fallback ('tournament') since there are
    // no alphanumeric characters to slugify. createTrack accepts whatever
    // slugify produces and lets the operator type a real name later if
    // they care.
    const db = freshDb();
    const res = createTrack(db, '!!!');
    const row = db.prepare(`SELECT slug FROM rc_tracks WHERE id = ?`).get(res.trackId) as {
      slug: string;
    };
    expect(row.slug).toBe('tournament');
  });
});
