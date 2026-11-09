CREATE TABLE "user_expression_usage" (
	"user_id" text NOT NULL,
	"kind" varchar(8) NOT NULL,
	"key" varchar(64) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_expression_usage_user_id_kind_key_pk" PRIMARY KEY("user_id","kind","key"),
	CONSTRAINT "user_expression_usage_kind_check" CHECK ("user_expression_usage"."kind" IN ('emoji','sound'))
);
--> statement-breakpoint
ALTER TABLE "user_expression_usage" ADD CONSTRAINT "user_expression_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;