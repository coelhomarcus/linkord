-- Finishes turning groups into servers (0043 created and filled the server
-- side): each group's own conversation becomes its server's first text
-- channel, everything that pointed at "a group" now points at the server or
-- at the voice channel its call moved to, and the group-only structures go.
-- Ids are the same md5 derivations as 0043.

-- A call invite card asked to join the group's call, which now happens in
-- the server's voice channel.
UPDATE "messages" m SET "call_conversation_id" = md5('voice-channel:' || m.call_conversation_id)::uuid::text
FROM "conversations" c
WHERE c.id = m.call_conversation_id AND c.type IN ('group', 'bot');--> statement-breakpoint
-- A bot's channel stays read-only for people: only its webhook posts. 256 is
-- SEND_MESSAGES; the channel keeps its own overwrites instead of the category's.
INSERT INTO "channel_permission_overwrites" ("id", "server_id", "channel_id", "role_id", "allow", "deny")
SELECT md5('bot-readonly:' || c.id)::uuid::text, c.server_id, c.id, md5('everyone:' || c.id)::uuid::text, 0, 256
FROM "conversations" c
WHERE c.type = 'bot'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "conversations" c SET "type" = 'text', "title" = CASE WHEN u.locale = 'en-US' THEN 'general' ELSE 'geral' END,
  "permissions_synced" = (c.type <> 'bot')
FROM "servers" s
LEFT JOIN "users" u ON u.id = s.owner_id
WHERE s.id = c.server_id AND c.type IN ('group', 'bot');--> statement-breakpoint
DELETE FROM "conversation_members" WHERE "conversation_id" IN (SELECT "id" FROM "conversations" WHERE "server_id" IS NOT NULL);--> statement-breakpoint
DROP INDEX "conversation_members_one_owner_idx";--> statement-breakpoint
UPDATE "conversation_members" SET "role" = 'member' WHERE "role" <> 'member';--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "avatar";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "status_reason";--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_type_check" CHECK ("conversations"."type" IN ('direct','text','voice'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_server_channel_check" CHECK (("conversations"."type" = 'direct') = ("conversations"."server_id" IS NULL));--> statement-breakpoint

-- group_invitations → server_invitations. Every invitation pointed at a group,
-- so 0043 gave every row its server; the column was nullable only while both
-- existed.
ALTER TABLE "group_invitations" RENAME TO "server_invitations";--> statement-breakpoint
ALTER TABLE "server_invitations" RENAME CONSTRAINT "group_invitations_pkey" TO "server_invitations_pkey";--> statement-breakpoint
ALTER TABLE "server_invitations" DROP CONSTRAINT "group_invitations_conversation_id_conversations_id_fk";--> statement-breakpoint
DROP INDEX "group_invitations_pending_unique";--> statement-breakpoint
DROP INDEX "group_invitations_conversation_id_idx";--> statement-breakpoint
ALTER TABLE "server_invitations" DROP COLUMN "conversation_id";--> statement-breakpoint
ALTER TABLE "server_invitations" ALTER COLUMN "server_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "server_invitations" RENAME CONSTRAINT "group_invitations_server_id_servers_id_fk" TO "server_invitations_server_id_servers_id_fk";--> statement-breakpoint
ALTER TABLE "server_invitations" RENAME CONSTRAINT "group_invitations_inviter_id_users_id_fk" TO "server_invitations_inviter_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "server_invitations" RENAME CONSTRAINT "group_invitations_invitee_id_users_id_fk" TO "server_invitations_invitee_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "server_invitations" RENAME CONSTRAINT "group_invitations_status_check" TO "server_invitations_status_check";--> statement-breakpoint
ALTER INDEX "group_invitations_invitee_status_idx" RENAME TO "server_invitations_invitee_status_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "server_invitations_pending_unique" ON "server_invitations" USING btree ("server_id","invitee_id") WHERE "server_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "server_invitations_server_id_idx" ON "server_invitations" USING btree ("server_id");--> statement-breakpoint

ALTER TABLE "messages" DROP CONSTRAINT "messages_kind_reference_check";--> statement-breakpoint
ALTER TABLE "messages" RENAME COLUMN "group_invitation_id" TO "server_invitation_id";--> statement-breakpoint
ALTER TABLE "messages" RENAME CONSTRAINT "messages_group_invitation_id_group_invitations_id_fk" TO "messages_server_invitation_id_server_invitations_id_fk";--> statement-breakpoint
ALTER INDEX "messages_group_invitation_id_idx" RENAME TO "messages_server_invitation_id_idx";--> statement-breakpoint
UPDATE "messages" SET "kind" = 'server_invite' WHERE "kind" = 'group_invite';--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_reference_check" CHECK (("messages"."kind" = 'text' AND "messages"."server_invitation_id" IS NULL AND "messages"."call_conversation_id" IS NULL) OR ("messages"."kind" = 'server_invite' AND "messages"."call_conversation_id" IS NULL) OR ("messages"."kind" = 'call_invite' AND "messages"."server_invitation_id" IS NULL));--> statement-breakpoint

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_reference_check";--> statement-breakpoint
ALTER TABLE "notifications" RENAME COLUMN "group_invitation_id" TO "server_invitation_id";--> statement-breakpoint
ALTER TABLE "notifications" RENAME CONSTRAINT "notifications_group_invitation_id_group_invitations_id_fk" TO "notifications_server_invitation_id_server_invitations_id_fk";--> statement-breakpoint
UPDATE "notifications" SET "kind" = 'server_invitation', "dedupe_key" = 'server_invitation:' || substr("dedupe_key", length('group_invitation:') + 1)
WHERE "kind" = 'group_invitation';--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_reference_check" CHECK (
    ("notifications"."kind" IN ('friend_request','friend_accepted') AND "notifications"."friendship_id" IS NOT NULL AND "notifications"."server_invitation_id" IS NULL AND "notifications"."message_id" IS NULL)
    OR ("notifications"."kind" = 'server_invitation' AND "notifications"."server_invitation_id" IS NOT NULL AND "notifications"."friendship_id" IS NULL AND "notifications"."message_id" IS NULL)
    OR ("notifications"."kind" = 'mention' AND "notifications"."message_id" IS NOT NULL AND "notifications"."friendship_id" IS NULL AND "notifications"."server_invitation_id" IS NULL)
  );--> statement-breakpoint
-- undelivered pushes about an invitation keep their payload ({invitationId})
UPDATE "outbox_events" SET "type" = 'server_invitation_created' WHERE "type" = 'group_invitation_created';--> statement-breakpoint

-- group_sounds → server_sounds
ALTER TABLE "group_sounds" RENAME TO "server_sounds";--> statement-breakpoint
ALTER TABLE "server_sounds" RENAME CONSTRAINT "group_sounds_pkey" TO "server_sounds_pkey";--> statement-breakpoint
ALTER TABLE "server_sounds" DROP CONSTRAINT "group_sounds_conversation_id_conversations_id_fk";--> statement-breakpoint
DROP INDEX "group_sounds_conversation_id_idx";--> statement-breakpoint
ALTER TABLE "server_sounds" DROP COLUMN "conversation_id";--> statement-breakpoint
ALTER TABLE "server_sounds" ALTER COLUMN "server_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "server_sounds" RENAME CONSTRAINT "group_sounds_server_id_servers_id_fk" TO "server_sounds_server_id_servers_id_fk";--> statement-breakpoint
ALTER TABLE "server_sounds" RENAME CONSTRAINT "group_sounds_uploader_id_users_id_fk" TO "server_sounds_uploader_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "server_sounds" RENAME CONSTRAINT "group_sounds_volume_range" TO "server_sounds_volume_range";--> statement-breakpoint
CREATE INDEX "server_sounds_server_id_idx" ON "server_sounds" USING btree ("server_id","created_at");--> statement-breakpoint

-- A report about a group is now about the server it became.
ALTER TABLE "reports" DROP CONSTRAINT "reports_target_type_check";--> statement-breakpoint
UPDATE "reports" SET "target_type" = 'server', "target_id" = md5('server:' || "target_id")::uuid::text WHERE "target_type" = 'group';--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_type_check" CHECK ("reports"."target_type" IN ('user','server','message'));
