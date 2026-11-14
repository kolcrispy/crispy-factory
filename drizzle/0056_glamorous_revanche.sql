CREATE TABLE "realtime_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"digest" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "realtime_clients_digest_unique" UNIQUE("digest")
);
--> statement-breakpoint
CREATE TABLE "realtime_pairings" (
	"digest" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION factory_notify_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('factory_status', '');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER factory_jobs_status AFTER INSERT OR UPDATE OR DELETE ON jobs
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_status();
--> statement-breakpoint
CREATE TRIGGER factory_runs_status AFTER INSERT OR UPDATE OR DELETE ON runs
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_status();
--> statement-breakpoint
CREATE TRIGGER factory_agents_status AFTER INSERT OR UPDATE OR DELETE ON agents
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_status();
--> statement-breakpoint
CREATE TRIGGER factory_machines_status AFTER INSERT OR UPDATE OR DELETE ON machines
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_status();
--> statement-breakpoint
CREATE TRIGGER factory_repositories_status AFTER INSERT OR UPDATE OR DELETE ON repo_settings
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_status();
--> statement-breakpoint
CREATE TRIGGER factory_clients_status AFTER DELETE ON realtime_clients
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_status();
