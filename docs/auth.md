# Auth

## Model

Discord OAuth via `next-auth` (Discord provider). Scopes: `identify email`. Sign-in is rejected when Discord reports `verified === false` on the returned email — drive-by accounts stay out.

The stable foreign key for a player is the **Discord user id (snowflake)**. Never the handle, which users can change. First-login bootstraps a `players` row keyed on `discord_id`.

## Roles

| Role               | Granted to                                                                   |
|--------------------|------------------------------------------------------------------------------|
| `user`             | Default for any authenticated player.                                         |
| `tournament_admin` | Owners (and delegated admins) of a tournament.                                |
| `global_admin`     | Cross-app god mode. Bootstrapped via the env var `ELOUP_BOOTSTRAP_ADMIN_DISCORD_ID` (or `_EMAIL` fallback) — first matching login is promoted once, then the var is ignored. Q-AUTH-3 still pending; default written above. |

Role escalation rules outside that bootstrap are not yet specified.

## Result entry flow

Match status moves through `scheduled → pending → confirmed | disputed | cancelled`. Ratings update **only** on `pending → confirmed`, atomically with bet settlement.

The current policy is `result_confirmation = all_participants` — every named participant must confirm before ratings move. Q-AUTH-2 (whether confirmation is still required when any authenticated user can enter a match) is not yet decided; the policy will be revisited before M4 if the user picks (b) or (c).

## Why confirmation

Single-entry without confirmation degrades into "whoever logs first writes history." Confirmation by all participants is the cheapest way to keep the leaderboard honest at party scale, even with authenticated entry.
