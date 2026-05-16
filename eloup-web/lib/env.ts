import { z } from 'zod';

const schema = z.object({
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  APP_SESSION_SECRET: z.string().min(32),
  APP_DOMAIN: z.string().url(),
  DATABASE_PATH: z.string().min(1),
  ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const missing = Object.entries(flat)
      .map(([k, v]) => `${k}: ${(v ?? []).join('; ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${missing}`);
  }
  cached = parsed.data;
  return cached;
}
