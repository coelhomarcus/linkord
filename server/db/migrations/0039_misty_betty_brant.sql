CREATE TABLE "push_delivery_receipts" (
	"event_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_delivery_receipts_event_id_endpoint_pk" PRIMARY KEY("event_id","endpoint")
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
DROP INDEX "outbox_events_unprocessed_idx";--> statement-breakpoint
CREATE INDEX "outbox_events_ready_idx" ON "outbox_events" USING btree ("next_attempt_at","created_at") WHERE "outbox_events"."processed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "push_delivery_receipts" ADD CONSTRAINT "push_delivery_receipts_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;
