ALTER TABLE "intents" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."intent_kind";--> statement-breakpoint
CREATE TYPE "public"."intent_kind" AS ENUM('claim', 'stop', 'answer', 'merged', 'recheck_conflicts', 'open_t3', 'approve_merge', 'request_changes', 'close_job', 'onboard_repo', 'retry_stop', 'retry_job');--> statement-breakpoint
ALTER TABLE "intents" ALTER COLUMN "kind" SET DATA TYPE "public"."intent_kind" USING "kind"::"public"."intent_kind";