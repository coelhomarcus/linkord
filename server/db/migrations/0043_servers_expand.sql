CREATE TABLE "channel_permission_overwrites" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"channel_id" text,
	"category_id" text,
	"role_id" text,
	"user_id" text,
	"allow" integer DEFAULT 0 NOT NULL,
	"deny" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "channel_permission_overwrites_one_target_check" CHECK (num_nonnulls("channel_permission_overwrites"."channel_id", "channel_permission_overwrites"."category_id") = 1),
	CONSTRAINT "channel_permission_overwrites_one_subject_check" CHECK (num_nonnulls("channel_permission_overwrites"."role_id", "channel_permission_overwrites"."user_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "channel_read_states" (
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_message_id" integer,
	CONSTRAINT "channel_read_states_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "server_bans" (
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"banned_by" text,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_bans_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "server_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_invites" (
	"code" varchar(16) PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"channel_id" text,
	"created_by" text,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_member_roles" (
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "server_member_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "server_members" (
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_members_server_id_user_id_pk" PRIMARY KEY("server_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "server_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(16) DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"permissions" integer DEFAULT 0 NOT NULL,
	"hoist" boolean DEFAULT false NOT NULL,
	"mentionable" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"icon" text DEFAULT '' NOT NULL,
	"owner_id" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"status_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servers_status_check" CHECK ("servers"."status" IN ('active','suspended'))
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "server_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "category_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "topic" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "permissions_synced" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD COLUMN "server_id" text;--> statement-breakpoint
ALTER TABLE "group_sounds" ADD COLUMN "server_id" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "name" varchar(80) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "avatar" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_permission_overwrites" ADD CONSTRAINT "channel_permission_overwrites_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_permission_overwrites" ADD CONSTRAINT "channel_permission_overwrites_channel_id_conversations_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_permission_overwrites" ADD CONSTRAINT "channel_permission_overwrites_category_id_server_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."server_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_permission_overwrites" ADD CONSTRAINT "channel_permission_overwrites_role_id_server_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."server_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_permission_overwrites" ADD CONSTRAINT "channel_permission_overwrites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_read_states" ADD CONSTRAINT "channel_read_states_channel_id_conversations_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_read_states" ADD CONSTRAINT "channel_read_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_bans" ADD CONSTRAINT "server_bans_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_bans" ADD CONSTRAINT "server_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_bans" ADD CONSTRAINT "server_bans_banned_by_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_categories" ADD CONSTRAINT "server_categories_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_channel_id_conversations_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_member_roles" ADD CONSTRAINT "server_member_roles_role_id_server_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."server_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_member_roles" ADD CONSTRAINT "server_member_roles_server_id_user_id_server_members_server_id_user_id_fk" FOREIGN KEY ("server_id","user_id") REFERENCES "public"."server_members"("server_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_members" ADD CONSTRAINT "server_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_roles" ADD CONSTRAINT "server_roles_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_permission_overwrites_server_id_idx" ON "channel_permission_overwrites" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_permission_overwrites_target_subject_key" ON "channel_permission_overwrites" USING btree (coalesce("channel_id", "category_id"),coalesce("role_id", "user_id"));--> statement-breakpoint
CREATE INDEX "channel_read_states_user_id_idx" ON "channel_read_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "server_categories_server_id_idx" ON "server_categories" USING btree ("server_id","position");--> statement-breakpoint
CREATE INDEX "server_invites_server_id_idx" ON "server_invites" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "server_member_roles_server_id_idx" ON "server_member_roles" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "server_members_user_id_idx" ON "server_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "server_roles_server_id_idx" ON "server_roles" USING btree ("server_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "server_roles_one_default_idx" ON "server_roles" USING btree ("server_id") WHERE "server_roles"."is_default";--> statement-breakpoint
CREATE INDEX "servers_status_created_idx" ON "servers" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "servers_owner_id_idx" ON "servers" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_category_id_server_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."server_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sounds" ADD CONSTRAINT "group_sounds_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_server_id_idx" ON "conversations" USING btree ("server_id","position");--> statement-breakpoint
-- Every group (and bot) becomes a server laid out like
-- modules/servers/serverTemplate.ts. Ids are derived from the group's id, so
-- the backfill is deterministic and a re-run inserts nothing new. The group's
-- own conversation row becomes the server's first text channel (renamed and
-- retyped by 0044), which keeps every message, attachment, reaction, webhook
-- and staged upload where it already is. Names follow the owner's language;
-- 190352 is DEFAULT_EVERYONE_PERMISSIONS.
INSERT INTO "servers" ("id", "name", "icon", "owner_id", "status", "status_reason", "created_at", "updated_at")
SELECT md5('server:' || c.id)::uuid::text,
       left(coalesce(nullif(btrim(c.title), ''),
         CASE WHEN u.id IS NULL THEN 'Servidor'
              WHEN u.locale = 'en-US' THEN coalesce(nullif(u.display_name, ''), u.username) || '''s server'
              ELSE 'Servidor de ' || coalesce(nullif(u.display_name, ''), u.username) END), 100),
       c.avatar, o.user_id, c.status, c.status_reason, c.created_at, c.updated_at
FROM "conversations" c
LEFT JOIN "conversation_members" o ON o.conversation_id = c.id AND o.role = 'owner'
LEFT JOIN "users" u ON u.id = o.user_id
WHERE c.type IN ('group', 'bot')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "server_members" ("server_id", "user_id", "position", "joined_at")
SELECT md5('server:' || m.conversation_id)::uuid::text, m.user_id,
       (row_number() OVER (PARTITION BY m.user_id ORDER BY m.pinned_at DESC NULLS LAST, coalesce(c.last_message_at, c.created_at) DESC, c.id) - 1)::int,
       m.joined_at
FROM "conversation_members" m
JOIN "conversations" c ON c.id = m.conversation_id
WHERE c.type IN ('group', 'bot')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "server_roles" ("id", "server_id", "name", "position", "permissions", "is_default", "created_at")
SELECT md5('everyone:' || c.id)::uuid::text, md5('server:' || c.id)::uuid::text, '@everyone', 0, 190352, true, c.created_at
FROM "conversations" c
WHERE c.type IN ('group', 'bot')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "server_categories" ("id", "server_id", "name", "position", "created_at")
SELECT md5(k.kind || '-category:' || c.id)::uuid::text, md5('server:' || c.id)::uuid::text,
       CASE WHEN u.locale = 'en-US' THEN k.en ELSE k.pt END, k.position, c.created_at
FROM "conversations" c
CROSS JOIN (VALUES ('text', 0, 'Canais de texto', 'Text Channels'), ('voice', 1, 'Canais de voz', 'Voice Channels')) AS k(kind, position, pt, en)
LEFT JOIN "conversation_members" o ON o.conversation_id = c.id AND o.role = 'owner'
LEFT JOIN "users" u ON u.id = o.user_id
WHERE c.type IN ('group', 'bot')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "conversations" ("id", "type", "title", "created_by", "server_id", "category_id", "position", "created_at", "updated_at")
SELECT md5('voice-channel:' || c.id)::uuid::text, 'voice', CASE WHEN u.locale = 'en-US' THEN 'General' ELSE 'Geral' END, o.user_id,
       md5('server:' || c.id)::uuid::text, md5('voice-category:' || c.id)::uuid::text, 0, c.created_at, c.created_at
FROM "conversations" c
LEFT JOIN "conversation_members" o ON o.conversation_id = c.id AND o.role = 'owner'
LEFT JOIN "users" u ON u.id = o.user_id
WHERE c.type IN ('group', 'bot')
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "conversations" SET "server_id" = md5('server:' || "id")::uuid::text, "category_id" = md5('text-category:' || "id")::uuid::text, "position" = 0
WHERE "type" IN ('group', 'bot') AND "server_id" IS NULL;--> statement-breakpoint
INSERT INTO "channel_read_states" ("channel_id", "user_id", "last_read_message_id")
SELECT m.conversation_id, m.user_id, m.last_read_message_id
FROM "conversation_members" m
JOIN "conversations" c ON c.id = m.conversation_id
WHERE c.type IN ('group', 'bot') AND m.last_read_message_id IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "group_invitations" gi SET "server_id" = md5('server:' || gi.conversation_id)::uuid::text
FROM "conversations" c
WHERE c.id = gi.conversation_id AND c.type IN ('group', 'bot') AND gi.server_id IS NULL;--> statement-breakpoint
UPDATE "group_sounds" gs SET "server_id" = md5('server:' || gs.conversation_id)::uuid::text
FROM "conversations" c
WHERE c.id = gs.conversation_id AND c.type IN ('group', 'bot') AND gs.server_id IS NULL;--> statement-breakpoint
UPDATE "webhooks" w SET "name" = left(coalesce(nullif(btrim(c.title), ''), 'Bot'), 80), "avatar" = c.avatar
FROM "conversations" c
WHERE c.id = w.conversation_id AND w.name = '';
