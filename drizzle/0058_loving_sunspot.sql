DROP TRIGGER factory_jobs_update_work ON jobs;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "attention" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "builder_handoff" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "stage" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "stage" SET DEFAULT 'queued'::text;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "nudged_stage" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "stage" SET DATA TYPE text;--> statement-breakpoint
UPDATE jobs SET attention = jsonb_build_object('eventId', 'cutover:' || id, 'at', (extract(epoch from now()) * 1000)::bigint,
  'reason', coalesce(stage_summary, 'Legacy attempt needs inspection'),
  'action', coalesce(question, 'Inspect execution ownership and verified revision before resuming.'))
WHERE stage = 'waiting' OR attempt_review->>'state' = 'held'
  OR (stage NOT IN ('queued', 'pr', 'merged', 'failed') AND (attempt_review IS NULL OR attempt_review->>'state' IN ('building', 'repairing')));--> statement-breakpoint
UPDATE jobs SET stage = CASE
  WHEN stage = 'merged' THEN 'done'
  WHEN stage = 'failed' THEN 'failed'
  WHEN stage = 'pr' AND pr_url IS NOT NULL THEN 'ready'
  WHEN attempt_review->>'state' IN ('pending', 'reviewing', 'passed', 'held') THEN 'reviewing'
  WHEN stage = 'queued' AND machine_id IS NULL THEN 'queued'
  ELSE 'building' END,
  nudged_stage = NULL, nudged_at = NULL, stage_event_id = NULL, synced_event_id = NULL;--> statement-breakpoint
UPDATE runs SET stage = CASE
  WHEN stage = 'merged' THEN 'done'
  WHEN stage = 'failed' THEN 'failed'
  WHEN stage = 'pr' AND pr_url IS NOT NULL THEN 'ready'
  WHEN stage = 'queued' THEN 'queued'
  WHEN stage IS NULL THEN NULL
  ELSE 'building' END;--> statement-breakpoint
DELETE FROM events WHERE kind = 'stage';--> statement-breakpoint
DROP TYPE "public"."run_stage";--> statement-breakpoint
CREATE TYPE "public"."run_stage" AS ENUM('queued', 'building', 'reviewing', 'ready', 'done', 'failed');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "stage" SET DEFAULT 'queued'::"public"."run_stage";--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "stage" SET DATA TYPE "public"."run_stage" USING "stage"::"public"."run_stage";--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "nudged_stage" SET DATA TYPE "public"."run_stage" USING "nudged_stage"::"public"."run_stage";--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "stage" SET DATA TYPE "public"."run_stage" USING "stage"::"public"."run_stage";--> statement-breakpoint
CREATE TRIGGER factory_jobs_update_work AFTER UPDATE ON jobs
FOR EACH ROW WHEN (
  (OLD.stage, OLD.attempt, OLD.t3_thread_id, OLD.session_id, OLD.stop, OLD.attempt_review, OLD.answer, OLD.evidence, OLD.attention, OLD.builder_handoff)
  IS DISTINCT FROM
  (NEW.stage, NEW.attempt, NEW.t3_thread_id, NEW.session_id, NEW.stop, NEW.attempt_review, NEW.answer, NEW.evidence, NEW.attention, NEW.builder_handoff)
) EXECUTE FUNCTION factory_notify_work();