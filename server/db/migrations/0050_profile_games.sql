CREATE TABLE "profile_games" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"list" varchar(16) NOT NULL,
	"igdb_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"cover_image_id" varchar(40),
	"release_year" integer,
	"position" integer NOT NULL,
	CONSTRAINT "profile_games_list_check" CHECK ("profile_games"."list" IN ('favorite','liked','playing','wishlist'))
);
--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" DROP CONSTRAINT "profile_wall_widgets_type_check";--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ALTER COLUMN "connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "profile_wall_widgets" w SET "user_id" = c."user_id" FROM "profile_connections" c WHERE c."id" = w."connection_id";--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_games" ADD CONSTRAINT "profile_games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_games_list_game_unique" ON "profile_games" USING btree ("user_id","list","igdb_id");--> statement-breakpoint
CREATE INDEX "profile_games_user_list_idx" ON "profile_games" USING btree ("user_id","list","position");--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD CONSTRAINT "profile_wall_widgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_wall_widgets_games_unique" ON "profile_wall_widgets" USING btree ("user_id","type") WHERE "profile_wall_widgets"."connection_id" IS NULL;--> statement-breakpoint
CREATE INDEX "profile_wall_widgets_user_idx" ON "profile_wall_widgets" USING btree ("user_id","position");--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD CONSTRAINT "profile_wall_widgets_owner_check" CHECK (("profile_wall_widgets"."connection_id" IS NULL) = ("profile_wall_widgets"."type" LIKE 'igdb-%'));--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD CONSTRAINT "profile_wall_widgets_type_check" CHECK ("profile_wall_widgets"."type" IN ('mal-recent-anime','github-profile','github-calendar','igdb-favorite-game','igdb-liked-games','igdb-playing-games','igdb-wishlist-games'));