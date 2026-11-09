CREATE TABLE "server_stickers" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"uploader_id" text,
	"name" varchar(30) NOT NULL,
	"description" varchar(100) DEFAULT '' NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_expression_usage" DROP CONSTRAINT "user_expression_usage_kind_check";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sticker_id" text;--> statement-breakpoint
ALTER TABLE "server_stickers" ADD CONSTRAINT "server_stickers_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_stickers" ADD CONSTRAINT "server_stickers_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_stickers_server_name_key" ON "server_stickers" USING btree ("server_id",lower("name"));--> statement-breakpoint
ALTER TABLE "user_expression_usage" ADD CONSTRAINT "user_expression_usage_kind_check" CHECK ("user_expression_usage"."kind" IN ('emoji','sound','sticker'));