-- Self-service account deletion (a grace period on the account row) and data exports (one row per
-- requested ZIP). Two nullable columns without a default are metadata-only: no rewrite of users.
CREATE TABLE "data_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"size_bytes" bigint,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "data_exports_status_check" CHECK ("data_exports"."status" IN ('pending','running','ready','failed','expired'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_exports_user_requested_idx" ON "data_exports" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "data_exports_status_idx" ON "data_exports" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "users_deletion_due_idx" ON "users" USING btree ("deletion_due_at") WHERE "users"."deletion_due_at" IS NOT NULL;