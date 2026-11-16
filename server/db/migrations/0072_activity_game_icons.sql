-- The SteamGridDB icon of games people's desktop apps detected (modules/activity/activityGameIcons.ts),
-- shared by everyone so SteamGridDB is asked once per game. A new empty table: nothing to backfill.
CREATE TABLE "activity_game_icons" (
	"key" varchar(96) PRIMARY KEY NOT NULL,
	"icon_id" varchar(64),
	"resolved_at" timestamp with time zone NOT NULL
);
