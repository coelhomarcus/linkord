CREATE TABLE "call_presence" (
	"participant_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"deafened" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dm_calls_active" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"caller_id" text NOT NULL,
	"callee_id" text NOT NULL,
	"caller_participant_id" text NOT NULL,
	"callee_participant_id" text,
	"video" boolean NOT NULL,
	"phase" varchar(8) NOT NULL,
	"started_at" bigint NOT NULL,
	"answered_at" bigint,
	CONSTRAINT "dm_calls_active_phase_check" CHECK ("dm_calls_active"."phase" IN ('ringing','active'))
);
--> statement-breakpoint
ALTER TABLE "call_presence" ADD CONSTRAINT "call_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_presence" ADD CONSTRAINT "call_presence_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_calls_active" ADD CONSTRAINT "dm_calls_active_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_calls_active" ADD CONSTRAINT "dm_calls_active_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_calls_active" ADD CONSTRAINT "dm_calls_active_callee_id_users_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_presence_user_id_idx" ON "call_presence" USING btree ("user_id");