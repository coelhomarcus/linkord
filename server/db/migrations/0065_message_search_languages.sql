-- Message search stops being Portuguese-only and accent-sensitive: the vector
-- becomes the union of three accent-stripping configurations (exact word,
-- Portuguese stem, English stem; see server/src/db/textSearch.ts). Both
-- extensions are "trusted", so the database owner can create them without
-- being a superuser.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION linkord_simple (COPY = pg_catalog.simple);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION linkord_simple ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION linkord_portuguese (COPY = pg_catalog.portuguese);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION linkord_portuguese ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION linkord_english (COPY = pg_catalog.english);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION linkord_english ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem;--> statement-breakpoint
-- A generated column's expression can only be replaced by dropping it (which
-- also drops its index) and adding it again: one rewrite of the table, during
-- the boot migration, before the server takes connections. Building the same
-- vector as an expression index costs as long and makes every search re-parse
-- the messages it ranks.
ALTER TABLE "messages" DROP COLUMN "search_vector";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('linkord_simple', "messages"."text") || to_tsvector('linkord_portuguese', "messages"."text") || to_tsvector('linkord_english', "messages"."text")) STORED;--> statement-breakpoint
CREATE INDEX "messages_search_vector_idx" ON "messages" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "messages_text_trgm_idx" ON "messages" USING gin ("text" gin_trgm_ops);
