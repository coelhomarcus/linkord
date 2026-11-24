CREATE TABLE "playground_skins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"png" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
