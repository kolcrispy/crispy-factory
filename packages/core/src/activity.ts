import type { AuditRow, EventRow } from "@factory/storage/schema";
import { eventSchema } from "./events";

export type JobActivity = {
  id: string;
  jobId: string;
  at: string;
  kind: string;
  summary: string;
  refusal: string | null;
};

/** Public summaries only: never forward arbitrary payloads, paths, or tool output. */
export function eventActivity(jobId: string, row: EventRow): JobActivity | null {
  const parsed = eventSchema.safeParse(row.payload);
  if (!parsed.success) return null;
  const event = parsed.data;
  let summary: string;
  let kind: string = event.kind;
  switch (event.kind) {
    case "stage": kind = event.stage; summary = event.question ?? event.summary; break;
    case "builder_report": kind = event.action; summary = event.question ?? event.summary; break;
    case "session_start": summary = "Agent session started"; break;
    case "session_end": summary = "Agent session ended"; break;
    case "agent_start": summary = event.description; break;
    case "agent_launched": summary = "Subagent launched"; break;
    case "agent_stop": summary = `Subagent ${event.status}`; break;
    case "turn_stop": summary = event.lastMessage ?? "Agent turn ended"; break;
    case "evidence": summary = `${event.checks.filter(check => check.passed).length}/${event.checks.length} checks passed at ${event.sha.slice(0, 7)}${event.clean ? "" : " (uncommitted changes)"}`; break;
    case "screenshot": summary = "Screenshot attached"; break;
    case "usage": return null;
  }
  return { id: `event:${row.event_id}`, jobId, at: new Date(row.at).toISOString(), kind, summary: summary.slice(0, 2000), refusal: row.refusal };
}

export function auditActivity(row: AuditRow): JobActivity {
  return {
    id: `audit:${row.id}`, jobId: row.job_id, at: new Date(row.at).toISOString(),
    kind: row.action, summary: `${row.actor}${row.result ? `: ${row.result}` : ""}${row.detail ? ` - ${row.detail}` : ""}`.slice(0, 2000), refusal: null,
  };
}
