CREATE TABLE "connection_sync_limits" (
	"provider" varchar(16) PRIMARY KEY NOT NULL,
	"next_request_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" varchar(16) NOT NULL,
	"value" text NOT NULL,
	"url" text NOT NULL,
	"position" integer NOT NULL,
	"snapshot" jsonb,
	"synced_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_error" varchar(32),
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_until" timestamp with time zone,
	CONSTRAINT "profile_connections_provider_check" CHECK ("profile_connections"."provider" IN ('url','myanimelist','github'))
);
--> statement-breakpoint
CREATE TABLE "profile_wall_widgets" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"type" varchar(32) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "profile_wall_widgets_type_check" CHECK ("profile_wall_widgets"."type" IN ('mal-recent-anime','mal-favorite-anime','mal-favorite-manga','mal-favorite-characters','github-profile','github-calendar'))
);
--> statement-breakpoint
ALTER TABLE "profile_connections" ADD CONSTRAINT "profile_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_wall_widgets" ADD CONSTRAINT "profile_wall_widgets_connection_id_profile_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."profile_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_connections_user_idx" ON "profile_connections" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "profile_connections_due_idx" ON "profile_connections" USING btree ("next_sync_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_connections_service_unique" ON "profile_connections" USING btree ("user_id","provider") WHERE "profile_connections"."provider" <> 'url';--> statement-breakpoint
CREATE UNIQUE INDEX "profile_connections_url_unique" ON "profile_connections" USING btree ("user_id",lower("url"));--> statement-breakpoint
CREATE UNIQUE INDEX "profile_wall_widgets_connection_type_unique" ON "profile_wall_widgets" USING btree ("connection_id","type");--> statement-breakpoint
INSERT INTO profile_connections (id, user_id, provider, value, url, position)
SELECT md5('profile-connection:' || user_id || ':' || position::text), user_id, 'url', value, value, (position - 1)::integer
FROM (
  SELECT DISTINCT ON (u.id, lower(link.value)) u.id AS user_id, link.value, link.position
  FROM users u CROSS JOIN LATERAL jsonb_array_elements_text(u.profile_links) WITH ORDINALITY AS link(value, position)
  ORDER BY u.id, lower(link.value), link.position
) legacy;
