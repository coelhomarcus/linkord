CREATE TABLE "playground_forgotten_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL
);
