-- What each account played or used lately, for the profile's "Atividade recente" (modules/activity/
-- activityHistory.ts). A new empty table: history starts with this deploy, nothing to backfill.
CREATE TABLE "activity_history" (
	"user_id" text NOT NULL,
	"key" varchar(80) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"name" varchar(64) NOT NULL,
	"icon" text,
	"last_played_at" timestamp with time zone NOT NULL,
	CONSTRAINT "activity_history_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "activity_history" ADD CONSTRAINT "activity_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_history_user_played_idx" ON "activity_history" USING btree ("user_id","last_played_at");