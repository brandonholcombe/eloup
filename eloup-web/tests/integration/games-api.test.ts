import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '@/lib/db/migrate';

// Per-test session/db plumbing. The route handlers cache the db handle
// on first call and the auth helper is module-scoped, so we mock both
// to expose simple seams the tests can drive directly.
let currentSession: { user: { id: string; role: 'user' | 'global_admin' } } | null = null;
let currentDb: Database.Database | null = null;

vi.mock('@/lib/auth', () => ({
  auth: () => Promise.resolve(currentSession),
}));

vi.mock('@/lib/db/client', () => ({
  db: () => currentDb!,
}));

// Imports must come AFTER vi.mock so the route module reads the mocked
// auth + db modules at first evaluation.
const { POST: postGame } = await import('@/app/api/games/route');
const { PATCH: patchGame } = await import('@/app/api/games/[gameId]/route');

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'eloup-games-api-'));
  const db = new Database(join(dir, 'test.sqlite'));
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function seedPlayers(db: Database.Database) {
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES ('admin', 'admin', 'admin', 'Admin', 'global_admin')`,
  ).run();
  db.prepare(
    `INSERT INTO players(id, discord_id, discord_handle, display_name, role)
     VALUES ('user', 'user', 'user', 'User', 'user')`,
  ).run();
}

function bodyReq(payload: unknown): Request {
  return new Request('http://localhost/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function patchReq(payload: unknown): Request {
  return new Request('http://localhost/api/games/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  currentDb = freshDb();
  seedPlayers(currentDb);
  currentSession = null;
});

describe('POST /api/games', () => {
  it('returns 201 with explicit category', async () => {
    currentSession = { user: { id: 'admin', role: 'global_admin' } };
    const resp = await postGame(
      bodyReq({
        name: 'Forza',
        slug: 'forza',
        format: '1v1',
        min_participants: 2,
        max_participants: 8,
        default_k: 32,
        category: 'racing',
      }),
    );
    expect(resp.status).toBe(201);
    const row = currentDb!
      .prepare(`SELECT category FROM games WHERE slug = 'forza'`)
      .get() as { category: string };
    expect(row.category).toBe('racing');
  });

  it('defaults to "other" when category is omitted', async () => {
    currentSession = { user: { id: 'admin', role: 'global_admin' } };
    const resp = await postGame(
      bodyReq({
        name: 'Mystery',
        slug: 'mystery',
        format: '1v1',
        min_participants: 2,
        max_participants: 2,
        default_k: 32,
      }),
    );
    expect(resp.status).toBe(201);
    const row = currentDb!
      .prepare(`SELECT category FROM games WHERE slug = 'mystery'`)
      .get() as { category: string };
    expect(row.category).toBe('other');
  });

  it('rejects unknown category with 400', async () => {
    currentSession = { user: { id: 'admin', role: 'global_admin' } };
    const resp = await postGame(
      bodyReq({
        name: 'WAT',
        slug: 'wat',
        format: '1v1',
        min_participants: 2,
        max_participants: 2,
        default_k: 32,
        category: 'mystery',
      }),
    );
    expect(resp.status).toBe(400);
  });

  it('returns 401 when unauthenticated (reviewer MINOR #5)', async () => {
    currentSession = null;
    const resp = await postGame(
      bodyReq({
        name: 'X',
        slug: 'x',
        format: '1v1',
        min_participants: 2,
        max_participants: 2,
        default_k: 32,
      }),
    );
    expect(resp.status).toBe(401);
  });

  it('returns 403 when authenticated as non-admin', async () => {
    currentSession = { user: { id: 'user', role: 'user' } };
    const resp = await postGame(
      bodyReq({
        name: 'X',
        slug: 'x',
        format: '1v1',
        min_participants: 2,
        max_participants: 2,
        default_k: 32,
      }),
    );
    expect(resp.status).toBe(403);
  });
});

describe('PATCH /api/games/[gameId]', () => {
  function seedGame() {
    currentDb!
      .prepare(
        `INSERT INTO games(id, name, slug, format, min_participants, max_participants, default_k)
         VALUES ('g1', 'G1', 'g1', '1v1', 2, 2, 32)`,
      )
      .run();
  }

  it('returns 401 when unauthenticated', async () => {
    seedGame();
    currentSession = null;
    const resp = await patchGame(patchReq({ category: 'racing' }), {
      params: Promise.resolve({ gameId: 'g1' }),
    });
    expect(resp.status).toBe(401);
  });

  it('returns 403 when authenticated as non-admin', async () => {
    seedGame();
    currentSession = { user: { id: 'user', role: 'user' } };
    const resp = await patchGame(patchReq({ category: 'racing' }), {
      params: Promise.resolve({ gameId: 'g1' }),
    });
    expect(resp.status).toBe(403);
  });

  it('returns 404 for an unknown gameId', async () => {
    currentSession = { user: { id: 'admin', role: 'global_admin' } };
    const resp = await patchGame(patchReq({ category: 'racing' }), {
      params: Promise.resolve({ gameId: 'does-not-exist' }),
    });
    expect(resp.status).toBe(404);
  });

  it('returns 400 for unknown category', async () => {
    seedGame();
    currentSession = { user: { id: 'admin', role: 'global_admin' } };
    const resp = await patchGame(patchReq({ category: 'mystery' }), {
      params: Promise.resolve({ gameId: 'g1' }),
    });
    expect(resp.status).toBe(400);
  });

  it('returns 200 and UPDATEs the category on a valid request', async () => {
    seedGame();
    currentSession = { user: { id: 'admin', role: 'global_admin' } };
    const resp = await patchGame(patchReq({ category: 'racing' }), {
      params: Promise.resolve({ gameId: 'g1' }),
    });
    expect(resp.status).toBe(200);
    const row = currentDb!
      .prepare(`SELECT category FROM games WHERE id = 'g1'`)
      .get() as { category: string };
    expect(row.category).toBe('racing');
  });
});
