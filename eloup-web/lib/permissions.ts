import type Database from 'better-sqlite3';

export type Role = 'user' | 'tournament_admin' | 'global_admin';

export type SessionPlayer = {
  id: string;
  role: Role;
};

export function canCreateGame(s: SessionPlayer | null): boolean {
  return s?.role === 'global_admin';
}

export function canEditMatch(s: SessionPlayer | null, matchCreatedBy: string): boolean {
  if (!s) return false;
  if (s.role === 'global_admin') return true;
  return s.id === matchCreatedBy;
}

export function canConfirmRow(
  db: Database.Database,
  s: SessionPlayer | null,
  matchId: string,
): boolean {
  if (!s) return false;
  const row = db
    .prepare('SELECT confirmed_at FROM match_participants WHERE match_id = ? AND player_id = ?')
    .get(matchId, s.id) as { confirmed_at: string | null } | undefined;
  if (!row) return false;
  return row.confirmed_at == null;
}
