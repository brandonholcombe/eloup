import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { slugify, withSuffix } from '@/lib/slug';

export type CreateTrackResult = {
  trackId: string;
  // true when an existing track matched the typed name case-insensitively
  // and was reused; false when a new rc_tracks row was inserted.
  matched: boolean;
};

// Shared helper between the import route and the H2 PATCH-track route.
// Case-insensitive name match short-circuits to the existing track so
// "Outdoor Long" / "outdoor long" cannot become two separate rows from
// a fat-finger. If no name match, slugify + collision-suffix and insert.
export function createTrack(db: Database.Database, name: string): CreateTrackResult {
  const existing = db
    .prepare(`SELECT id FROM rc_tracks WHERE lower(name) = lower(?)`)
    .get(name) as { id: string } | undefined;
  if (existing) return { trackId: existing.id, matched: true };

  const id = randomUUID();
  const baseSlug = slugify(name) || 'track';
  let n = 1;
  const findSlug = db.prepare(`SELECT 1 FROM rc_tracks WHERE slug = ?`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = withSuffix(baseSlug, n);
    if (!findSlug.get(candidate)) {
      db.prepare(`INSERT INTO rc_tracks(id, name, slug) VALUES (?, ?, ?)`).run(id, name, candidate);
      return { trackId: id, matched: false };
    }
    n++;
  }
}
