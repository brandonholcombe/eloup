import NextAuth, { type NextAuthConfig } from 'next-auth';
import Discord from 'next-auth/providers/discord';
import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { findPlayerByDiscordId } from '@/lib/db/queries';
import { bootstrapPlayer, type DiscordProfile } from '@/lib/db/players';
import type { Role } from '@/lib/permissions';

export { bootstrapPlayer };
export type { DiscordProfile };

function buildConfig(): NextAuthConfig {
  const e = env();
  return {
    secret: e.APP_SESSION_SECRET,
    // Self-hosted behind nginx ingress (cluster) or behind next dev/start (local).
    // Auth.js v5 demands trustHost: true outside of Vercel auto-detect.
    trustHost: true,
    session: { strategy: 'jwt' },
    providers: [
      Discord({
        clientId: e.DISCORD_CLIENT_ID,
        clientSecret: e.DISCORD_CLIENT_SECRET,
        // Auth.js v5 merges this object onto the default Discord provider
        // shallowly. Overriding `authorization` here would wipe the default
        // URL ("https://discord.com/api/oauth2/authorize?scope=identify+email")
        // and Auth.js then throws `TypeError: Invalid URL` from `new URL(undefined)`.
        // Defaults already include `identify email` scope, so no override needed.
      }),
    ],
    callbacks: {
      signIn({ profile }) {
        const p = profile as Partial<DiscordProfile> | undefined;
        if (!p?.id) return false;
        if (p.verified !== true) return false;
        bootstrapPlayer(db(), p as DiscordProfile, e.ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID);
        return true;
      },
      jwt({ token, profile }) {
        if (profile && (profile as Partial<DiscordProfile>).id) {
          const p = profile as DiscordProfile;
          const row = findPlayerByDiscordId(db(), p.id);
          if (row) {
            token.playerId = row.id;
            token.role = row.role;
            token.discordId = row.discord_id;
          }
        }
        return token;
      },
      session({ session, token }) {
        if (token.playerId) {
          session.user = {
            ...session.user,
            id: token.playerId as string,
            role: (token.role as Role) ?? 'user',
            discordId: token.discordId as string,
          } as typeof session.user & { id: string; role: Role; discordId: string };
        }
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildConfig);
