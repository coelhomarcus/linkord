CREATE TABLE "user_badges" (
	"user_id" text NOT NULL,
	"badge" varchar(32) NOT NULL,
	"source" varchar(16) NOT NULL,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_id_badge_pk" PRIMARY KEY("user_id","badge"),
	CONSTRAINT "user_badges_badge_check" CHECK ("user_badges"."badge" IN ('developer','supporter')),
	CONSTRAINT "user_badges_source_check" CHECK ("user_badges"."source" IN ('admin','automatic'))
);
--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;