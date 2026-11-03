CREATE TABLE "group_sounds" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"uploader_id" text,
	"name" varchar(32) NOT NULL,
	"emoji" varchar(16) DEFAULT '' NOT NULL,
	"volume" integer DEFAULT 100 NOT NULL,
	"size" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_sounds_volume_range" CHECK ("group_sounds"."volume" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "group_sounds" ADD CONSTRAINT "group_sounds_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sounds" ADD CONSTRAINT "group_sounds_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_sounds_conversation_id_idx" ON "group_sounds" USING btree ("conversation_id","created_at");