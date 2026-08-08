-- H12: guest tournament entrants. A guest is a normal players row that has no
-- real Discord identity (synthetic discord_id = 'guest:<uuid>', which can never
-- collide with a numeric Discord snowflake, so a guest can never be logged into).
-- is_guest flags them so they can be badged in the UI, excluded from player
-- search, and purged when their only tournament is deleted.
ALTER TABLE players ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
