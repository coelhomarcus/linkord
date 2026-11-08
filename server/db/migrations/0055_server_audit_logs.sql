CREATE TABLE "server_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"actor_id" text,
	"actor_label" text DEFAULT '' NOT NULL,
	"action" varchar(48) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" text DEFAULT '' NOT NULL,
	"target_label" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_audit_logs" ADD CONSTRAINT "server_audit_logs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_audit_server_created_idx" ON "server_audit_logs" USING btree ("server_id","created_at","id");--> statement-breakpoint
CREATE INDEX "server_audit_server_actor_idx" ON "server_audit_logs" USING btree ("server_id","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "server_audit_server_action_idx" ON "server_audit_logs" USING btree ("server_id","action","created_at");--> statement-breakpoint
CREATE INDEX "server_audit_server_target_idx" ON "server_audit_logs" USING btree ("server_id","target_id","created_at");--> statement-breakpoint
CREATE INDEX "server_audit_created_idx" ON "server_audit_logs" USING btree ("created_at");