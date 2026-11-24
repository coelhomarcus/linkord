CREATE TABLE "playground_skins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"png" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playground_skins" ADD CONSTRAINT "playground_skins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;