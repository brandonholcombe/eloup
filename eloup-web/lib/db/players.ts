import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { findPlayerByDiscordId, type PlayerRow } from '@/lib/db/queries';
import type { Role } from '@/lib/permissions';

export type DiscordProfile = {
  id: string;
  username: string;
  global_name?: string | null;
  email?: string | null;
  verified?: boolean;
  avatar?: string | null;
};

export type BootstrapResult = {
  playerId: string;
  role: Role;
  created: boolean;
  promoted: boolean;
};

export function bootstrapPlayer(
  database: Database.Database,
  profile: DiscordProfile,
  bootstrapAdminDiscordId: string | undefined,
): BootstrapResult {
  const tx = database.transaction((): BootstrapResult => {
    const existing = findPlayerByDiscordId(database, profile.id);
    if (existing) {
      return maybePromote(database, existing, bootstrapAdminDiscordId);
    }
    const id = randomUUID();
    const avatarUrl = profile.avatar
      ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
      : null;
    database
      .prepare(
        `INSERT INTO players(id, discord_id, discord_handle, display_name, email,
                             email_verified, avatar_url, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'user')`,
      )
      .run(
        id,
        profile.id,
        profile.username,
        profile.global_name ?? profile.username,
        profile.email ?? null,
        profile.verified ? 1 : 0,
        avatarUrl,
      );
    const created: BootstrapResult = { playerId: id, role: 'user', created: true, promoted: false };
    if (bootstrapAdminDiscordId && profile.id === bootstrapAdminDiscordId) {
      database.prepare(`UPDATE players SET role = 'global_admin' WHERE id = ?`).run(id);
      return { ...created, role: 'global_admin', promoted: true };
    }
    return created;
  });
  return tx.immediate();
}

function maybePromote(
  database: Database.Database,
  player: PlayerRow,
  bootstrapAdminDiscordId: string | undefined,
): BootstrapResult {
  if (
    bootstrapAdminDiscordId &&
    player.discord_id === bootstrapAdminDiscordId &&
    player.role !== 'global_admin'
  ) {
    database.prepare(`UPDATE players SET role = 'global_admin' WHERE id = ?`).run(player.id);
    return { playerId: player.id, role: 'global_admin', created: false, promoted: true };
  }
  return { playerId: player.id, role: player.role, created: false, promoted: false };
}
