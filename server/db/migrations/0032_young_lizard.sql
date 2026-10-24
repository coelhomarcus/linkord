ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "users" AS u
SET "last_seen_at" = s.max_seen
FROM (
  SELECT "user_id", MAX("last_seen_at") AS max_seen
  FROM "sessions"
  GROUP BY "user_id"
) AS s
WHERE u."id" = s."user_id" AND u."last_seen_at" IS NULL;