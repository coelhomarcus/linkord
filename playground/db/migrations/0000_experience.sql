CREATE TABLE "playground_experience" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playground_experience_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
