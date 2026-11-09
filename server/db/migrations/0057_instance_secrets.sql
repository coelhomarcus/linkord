CREATE TABLE "instance_secrets" (
	"name" varchar(32) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
