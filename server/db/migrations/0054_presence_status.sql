ALTER TABLE "users" ADD COLUMN "presence_status" varchar(16) DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "custom_status_emoji" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "custom_status_text" varchar(128) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "custom_status_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_presence_status_check" CHECK ("users"."presence_status" IN ('online','idle','dnd','invisible'));