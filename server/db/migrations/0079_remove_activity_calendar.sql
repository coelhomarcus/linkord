ALTER TABLE "profile_wall_widgets" DROP CONSTRAINT "profile_wall_widgets_type_check";--> statement-breakpoint
DELETE FROM "profile_wall_widgets" WHERE "type" = 'activity-calendar';--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD CONSTRAINT "profile_wall_widgets_type_check" CHECK ("profile_wall_widgets"."type" IN ('mal-recent-anime','github-profile','github-calendar','igdb-favorite-game','igdb-liked-games','igdb-playing-games','igdb-wishlist-games','activity-top','activity-recent','activity-summary','steam-recent','steam-top','steam-profile','twitch-live','twitch-vods'));
