CREATE FUNCTION factory_notify_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('factory_work', '');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER factory_jobs_insert_work AFTER INSERT ON jobs
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_work();
--> statement-breakpoint
CREATE TRIGGER factory_jobs_update_work AFTER UPDATE ON jobs
FOR EACH ROW WHEN (
  (OLD.stage, OLD.attempt, OLD.t3_thread_id, OLD.session_id, OLD.stop, OLD.attempt_review, OLD.answer, OLD.evidence)
  IS DISTINCT FROM
  (NEW.stage, NEW.attempt, NEW.t3_thread_id, NEW.session_id, NEW.stop, NEW.attempt_review, NEW.answer, NEW.evidence)
) EXECUTE FUNCTION factory_notify_work();
--> statement-breakpoint
CREATE TRIGGER factory_intents_work AFTER INSERT ON intents
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_work();
--> statement-breakpoint
CREATE TRIGGER factory_events_work AFTER INSERT ON events
FOR EACH ROW WHEN (NEW.kind IN ('turn_stop', 'session_end'))
EXECUTE FUNCTION factory_notify_work();
