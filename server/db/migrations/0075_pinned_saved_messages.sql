-- Pinned messages (a flag on the message, a "pinned a message" notice that
-- only references it, and a per-member "pins seen" for the header dot) and
-- each account's saved messages.
CREATE TABLE "saved_messages" (
	"user_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"conversation_id" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_messages_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_kind_reference_check";--> statement-breakpoint
ALTER TABLE "channel_read_states" ADD COLUMN "pins_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "pins_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_pin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "pinned_by" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "pinned_message_id" integer;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_messages_user_saved_at_idx" ON "saved_messages" USING btree ("user_id","saved_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "saved_messages_message_id_idx" ON "saved_messages" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_pinned_message_id_messages_id_fk" FOREIGN KEY ("pinned_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_pinned_idx" ON "messages" USING btree ("conversation_id","pinned_at" DESC NULLS LAST) WHERE "messages"."pinned_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_pinned_message_id_idx" ON "messages" USING btree ("pinned_message_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_pinned_message_kind_check" CHECK ("messages"."pinned_message_id" IS NULL OR "messages"."kind" = 'pin_notice');--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_pinned_kind_check" CHECK ("messages"."pinned_at" IS NULL OR "messages"."kind" = 'text');--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_reference_check" CHECK (("messages"."kind" = 'text' AND "messages"."server_invitation_id" IS NULL AND "messages"."call_conversation_id" IS NULL) OR ("messages"."kind" = 'server_invite' AND "messages"."call_conversation_id" IS NULL) OR ("messages"."kind" = 'call_invite' AND "messages"."server_invitation_id" IS NULL) OR ("messages"."kind" = 'dm_call' AND "messages"."server_invitation_id" IS NULL AND "messages"."call_conversation_id" IS NULL) OR ("messages"."kind" = 'pin_notice' AND "messages"."server_invitation_id" IS NULL AND "messages"."call_conversation_id" IS NULL));--> statement-breakpoint
-- Pinning used to be MANAGE_MESSAGES (1 << 11) and is now PIN_MESSAGES
-- (1 << 22). Every role and channel overwrite that allowed or denied the first
-- does the same with the second, so nobody gains or loses what they could do.
UPDATE "server_roles" SET "permissions" = "permissions" | 4194304 WHERE "permissions" & 2048 <> 0;--> statement-breakpoint
UPDATE "channel_permission_overwrites" SET "allow" = "allow" | 4194304 WHERE "allow" & 2048 <> 0;--> statement-breakpoint
UPDATE "channel_permission_overwrites" SET "deny" = "deny" | 4194304 WHERE "deny" & 2048 <> 0;
