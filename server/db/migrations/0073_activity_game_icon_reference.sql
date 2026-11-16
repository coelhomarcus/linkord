-- Whether a game's icon was chosen against a reference (modules/activity/activityGameIcons.ts). Rows from
-- before count as not, so they are worked out again the first time someone sends a program icon.
ALTER TABLE "activity_game_icons" ADD COLUMN "referenced" boolean DEFAULT false NOT NULL;