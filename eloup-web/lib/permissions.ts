import type Database from 'better-sqlite3';

export type Role = 'user' | 'tournament_admin' | 'global_admin';

export type SessionPlayer = {
  id: string;
  role: Role;
};

export type MatchForEdit = {
  created_by: string;
  tournament_id: string | null;
};

export function canCreateGame(s: SessionPlayer | null): boolean {
  return s?.role === 'global_admin';
}

export type AdminNavLink = { href: string; label: string };

export function adminNavLinks(role: Role | undefined): AdminNavLink[] {
  if (role !== 'global_admin') return [];
  return [{ href: '/games', label: 'Games' }];
}

export function canEditMatch(
  db: Database.Database,
  s: SessionPlayer | null,
  match: MatchForEdit,
): boolean {
  if (!s) return false;
  if (s.role === 'global_admin') return true;
  if (s.id === match.created_by) return true;
  if (match.tournament_id && isTournamentAdmin(db, s, match.tournament_id)) return true;
  return false;
}

// Force-confirm a pending match without requiring all participants' consent.
// global_admin can force any match anywhere. tournament_admin can force any
// match in their tournament. Regular users never can.
export function canForceConfirmMatch(
  db: Database.Database,
  s: SessionPlayer | null,
  match: { tournament_id: string | null },
): boolean {
  if (!s) return false;
  if (s.role === 'global_admin') return true;
  if (match.tournament_id && isTournamentAdmin(db, s, match.tournament_id)) return true;
  return false;
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

export function isTournamentMember(
  db: Database.Database,
  playerId: string,
  tournamentId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM tournament_members WHERE tournament_id = ? AND player_id = ?`,
    )
    .get(tournamentId, playerId) as { ok: number } | undefined;
  return !!row;
}

export function isTournamentAdmin(
  db: Database.Database,
  s: SessionPlayer | null,
  tournamentId: string,
): boolean {
  if (!s) return false;
  if (s.role === 'global_admin') return true;
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM tournament_admins WHERE tournament_id = ? AND player_id = ?`,
    )
    .get(tournamentId, s.id) as { ok: number } | undefined;
  return !!row;
}
