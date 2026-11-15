ALTER TABLE "repo_settings" DROP COLUMN "require_bugbot";
--> statement-breakpoint
DELETE FROM events WHERE kind IN ('merge_decision', 'github_snapshot') AND payload::text ~* 'bugbot';
--> statement-breakpoint
DELETE FROM audit_log WHERE action IN ('merge_decided', 'merge_failed') AND detail ~* 'bugbot';
--> statement-breakpoint
UPDATE jobs SET merge_decision = NULL, github_snapshot = NULL, updated_at = now()
WHERE merge_decision::text ~* 'bugbot' OR github_snapshot::text ~* 'bugbot';