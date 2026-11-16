-- Whether an account shows the game or app its desktop app detects, and the ones it hides
-- (modules/presence/activity.ts). Every existing account starts sharing, as a new one does.
ALTER TABLE "users" ADD COLUMN "activity_sharing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hidden_activities" jsonb DEFAULT '[]'::jsonb NOT NULL;