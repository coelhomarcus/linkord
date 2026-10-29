ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_reference_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "message_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_message_id_idx" ON "notifications" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_reference_check" CHECK (
    ("notifications"."kind" IN ('friend_request','friend_accepted') AND "notifications"."friendship_id" IS NOT NULL AND "notifications"."group_invitation_id" IS NULL AND "notifications"."message_id" IS NULL)
    OR ("notifications"."kind" = 'group_invitation' AND "notifications"."group_invitation_id" IS NOT NULL AND "notifications"."friendship_id" IS NULL AND "notifications"."message_id" IS NULL)
    OR ("notifications"."kind" = 'mention' AND "notifications"."message_id" IS NOT NULL AND "notifications"."friendship_id" IS NULL AND "notifications"."group_invitation_id" IS NULL)
  );