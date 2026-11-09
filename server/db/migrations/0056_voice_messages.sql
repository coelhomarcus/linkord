ALTER TABLE "attachments" ADD COLUMN "voice_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "voice_waveform" text;--> statement-breakpoint
ALTER TABLE "staged_attachments" ADD COLUMN "voice_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "staged_attachments" ADD COLUMN "voice_waveform" text;