-- The IGDB name and cover of games people's desktop apps detected (modules/activity/activityGames.ts),
-- shared by everyone so IGDB is asked once per game. A new empty table: nothing to backfill.
CREATE TABLE "activity_games" (
	"key" varchar(96) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_id" varchar(40),
	"resolved_at" timestamp with time zone NOT NULL
);
