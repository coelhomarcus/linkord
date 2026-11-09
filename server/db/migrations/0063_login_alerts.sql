CREATE TABLE "known_logins" (
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_logins_user_id_fingerprint_pk" PRIMARY KEY("user_id","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_alert_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "known_logins" ADD CONSTRAINT "known_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "known_logins_last_login_at_idx" ON "known_logins" USING btree ("last_login_at");--> statement-breakpoint
-- browsers that hold a session today count as known, so the first login after the upgrade does not alert
-- (same fingerprint as loginFingerprint() in modules/auth/loginAlert.ts: sha256 of ip, a newline and the user agent)
INSERT INTO "known_logins" ("user_id", "fingerprint", "last_login_at")
SELECT "user_id", encode(sha256(convert_to("ip" || E'\n' || "user_agent", 'UTF8')), 'hex'), max("last_seen_at")
FROM "sessions" GROUP BY "user_id", "ip", "user_agent";
