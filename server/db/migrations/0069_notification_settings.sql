-- Per-account notification levels and mutes, one row per server or per channel/DM the person changed
-- (modules/notifications/notificationSettings.ts). A new empty table: nothing to backfill.
CREATE TABLE "notification_settings" (
	"user_id" text NOT NULL,
	"server_id" text,
	"conversation_id" text,
	"level" varchar(16),
	"muted" boolean DEFAULT false NOT NULL,
	"muted_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_scope_check" CHECK (num_nonnulls("notification_settings"."server_id", "notification_settings"."conversation_id") = 1),
	CONSTRAINT "notification_settings_level_check" CHECK ("notification_settings"."level" IS NULL OR "notification_settings"."level" IN ('all','mentions','nothing'))
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_user_server_key" ON "notification_settings" USING btree ("user_id","server_id") WHERE "notification_settings"."server_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_settings_user_conversation_key" ON "notification_settings" USING btree ("user_id","conversation_id") WHERE "notification_settings"."conversation_id" IS NOT NULL;