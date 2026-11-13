DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "codex_slot_leases") OR EXISTS (SELECT 1 FROM "webhook_deliveries") THEN
    RAISE EXCEPTION 'Local cutover requires a fresh database; existing service records were preserved.';
  END IF;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "jobs_codex_slot_lease" ON "jobs";--> statement-breakpoint
DROP FUNCTION IF EXISTS "jobs_codex_slot_lease"();--> statement-breakpoint
DROP FUNCTION IF EXISTS "codex_slot_lease_move"(text, text, text, text);--> statement-breakpoint
DROP TABLE "codex_slot_leases" CASCADE;--> statement-breakpoint
DROP TABLE "webhook_deliveries" CASCADE;