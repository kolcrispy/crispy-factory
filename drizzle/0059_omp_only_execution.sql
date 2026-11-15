ALTER TABLE "jobs" RENAME COLUMN "t3_thread_id" TO "execution_id";
--> statement-breakpoint
ALTER TABLE "runs" RENAME COLUMN "t3_thread_id" TO "execution_id";
--> statement-breakpoint
DELETE FROM "intents" WHERE "kind" = 'open_t3';
--> statement-breakpoint
ALTER TABLE "intents" ALTER COLUMN "kind" TYPE text;
--> statement-breakpoint
DROP TYPE "public"."intent_kind";
--> statement-breakpoint
CREATE TYPE "public"."intent_kind" AS ENUM ('claim', 'stop', 'answer', 'merged', 'recheck_conflicts', 'approve_merge', 'request_changes', 'close_job', 'onboard_repo', 'retry_stop', 'review_action', 'retry_job');
--> statement-breakpoint
ALTER TABLE "intents" ALTER COLUMN "kind" TYPE "public"."intent_kind" USING "kind"::"public"."intent_kind";
