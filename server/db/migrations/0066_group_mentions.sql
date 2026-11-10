-- What a message's @everyone/@here and role mentions actually notified, so
-- readers highlight it by that rather than by its text. A constant default
-- is a metadata-only change: no rewrite of the table.
ALTER TABLE "messages" ADD COLUMN "mention_everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mention_role_ids" text[];
