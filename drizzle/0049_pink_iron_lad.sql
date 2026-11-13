ALTER TABLE "audit_log" ALTER COLUMN "action" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."audit_action";--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('merge_requested', 'merge_succeeded', 'merge_failed', 'merge_decided', 'override_fallback', 'follow_up_filed', 'review_dropped', 'job_archived', 'job_unarchived');--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "action" SET DATA TYPE "public"."audit_action" USING "action"::"public"."audit_action";--> statement-breakpoint
DROP INDEX "jobs_codex_slot_idx";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "budget_usd";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "execution";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "sandbox_id";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "sandbox_snapshot";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "codex_slot";--> statement-breakpoint
ALTER TABLE "repo_settings" DROP COLUMN "execution";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "execution";