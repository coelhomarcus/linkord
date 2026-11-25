DROP TABLE "playground_forgotten_accounts";--> statement-breakpoint
DROP TABLE "playground_skins";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_voice_mode_check";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_playground_chat_check";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_playground_chat_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "voice_mode";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "playground_chat_id";
