CREATE TRIGGER factory_events_status AFTER INSERT OR UPDATE OR DELETE ON events
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_status();
--> statement-breakpoint
CREATE TRIGGER factory_audit_status AFTER INSERT OR UPDATE OR DELETE ON audit_log
FOR EACH STATEMENT EXECUTE FUNCTION factory_notify_status();
