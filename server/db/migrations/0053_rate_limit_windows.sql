CREATE TABLE "rate_limit_windows" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "rate_limit_windows_window_ends_idx" ON "rate_limit_windows" USING btree ("window_ends_at");