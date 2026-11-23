CREATE TABLE "activity_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" varchar(80) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"name" varchar(64) NOT NULL,
	"icon" text,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "activity_sessions_times_check" CHECK ("activity_sessions"."last_seen_at" >= "activity_sessions"."started_at" AND ("activity_sessions"."ended_at" IS NULL OR "activity_sessions"."ended_at" = "activity_sessions"."last_seen_at"))
);
--> statement-breakpoint
ALTER TABLE "profile_connections" DROP CONSTRAINT "profile_connections_provider_check";--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" DROP CONSTRAINT "profile_wall_widgets_type_check";--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" DROP CONSTRAINT "profile_wall_widgets_owner_check";--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD COLUMN "period" integer;--> statement-breakpoint
ALTER TABLE "activity_sessions" ADD CONSTRAINT "activity_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_sessions_user_seen_idx" ON "activity_sessions" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "activity_sessions_seen_idx" ON "activity_sessions" USING btree ("last_seen_at");--> statement-breakpoint
ALTER TABLE "profile_connections" ADD CONSTRAINT "profile_connections_provider_check" CHECK ("profile_connections"."provider" IN ('url','myanimelist','github','steam','twitch'));--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD CONSTRAINT "profile_wall_widgets_period_check" CHECK ("profile_wall_widgets"."period" IS NULL OR ("profile_wall_widgets"."type" IN ('activity-top','activity-summary') AND "profile_wall_widgets"."period" IN (7,30)));--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD CONSTRAINT "profile_wall_widgets_type_check" CHECK ("profile_wall_widgets"."type" IN ('mal-recent-anime','github-profile','github-calendar','igdb-favorite-game','igdb-liked-games','igdb-playing-games','igdb-wishlist-games','activity-top','activity-calendar','activity-recent','activity-summary','steam-recent','steam-top','steam-profile','twitch-live','twitch-vods'));--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD CONSTRAINT "profile_wall_widgets_owner_check" CHECK (("profile_wall_widgets"."connection_id" IS NULL) = ("profile_wall_widgets"."type" LIKE 'igdb-%' OR "profile_wall_widgets"."type" LIKE 'activity-%'));