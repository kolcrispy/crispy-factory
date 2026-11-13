ALTER TABLE "repo_settings" ADD COLUMN "registration_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "registration_error" text;--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "checkout_path" text;--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "default_branch" text;