CREATE TABLE "playground_inventories" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"inventory" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playground_inventories_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "playground_worlds" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"generator" integer NOT NULL,
	"blocks" "bytea" NOT NULL,
	"furnaces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
