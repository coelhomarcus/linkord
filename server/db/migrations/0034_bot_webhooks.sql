CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "webhook_id" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhooks_conversation_id_idx" ON "webhooks" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_webhook_id_idx" ON "messages" USING btree ("webhook_id");