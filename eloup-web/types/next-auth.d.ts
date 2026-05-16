import type { DefaultSession } from 'next-auth';
import type { Role } from '@/lib/permissions';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      discordId: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    playerId?: string;
    role?: Role;
    discordId?: string;
  }
}
