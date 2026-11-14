ALTER TABLE "jobs" ADD COLUMN "review_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "attempt_review" jsonb;--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "review" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "review" jsonb;