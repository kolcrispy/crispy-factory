DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM jobs) OR EXISTS (SELECT 1 FROM repo_settings) OR EXISTS (SELECT 1 FROM slack_messages) OR EXISTS (SELECT 1 FROM notification_settings) THEN
    RAISE EXCEPTION 'The internal-job cutover requires a fresh database. Existing data was not removed.';
  END IF;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "repo_settings_codex_slot_lease" ON "repo_settings";--> statement-breakpoint
DROP FUNCTION IF EXISTS "repo_settings_codex_slot_lease"();--> statement-breakpoint
DROP TABLE "notification_settings" CASCADE;--> statement-breakpoint
DROP TABLE "slack_messages" CASCADE;--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "recipe" jsonb;--> statement-breakpoint
ALTER TABLE "repo_settings" DROP COLUMN "onboarding_state";--> statement-breakpoint
ALTER TABLE "repo_settings" DROP COLUMN "onboarding_detail";--> statement-breakpoint
ALTER TABLE "repo_settings" DROP COLUMN "onboarding_started_at";--> statement-breakpoint
ALTER TABLE "repo_settings" DROP COLUMN "onboarding_at";--> statement-breakpoint
DROP TYPE "public"."onboarding_state";