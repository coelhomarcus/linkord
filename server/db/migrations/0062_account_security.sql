ALTER TABLE "auth_codes" ADD COLUMN "challenge_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "id" text;--> statement-breakpoint
-- existing sessions get an id the same way the app makes one (random, unrelated to the token);
-- md5 over random() avoids depending on gen_random_uuid()/pgcrypto, as everywhere else
UPDATE "sessions" SET "id" = md5(random()::text || clock_timestamp()::text || "token_hash") WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_agent" varchar(512) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_codes_challenge_hash_idx" ON "auth_codes" USING btree ("challenge_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_id_key" ON "sessions" USING btree ("id");