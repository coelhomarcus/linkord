CREATE TABLE "server_emojis" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"uploader_id" text,
	"name" varchar(32) NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_emojis_name_check" CHECK ("server_emojis"."name" ~ '^[a-z0-9_]{2,32}$')
);
--> statement-breakpoint
ALTER TABLE "server_emojis" ADD CONSTRAINT "server_emojis_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_emojis" ADD CONSTRAINT "server_emojis_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_emojis_server_name_key" ON "server_emojis" USING btree ("server_id","name");