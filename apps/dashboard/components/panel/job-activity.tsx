"use client";

import type { AuditRow, EventRow } from "@factory/storage/schema";
import { auditActivity, eventActivity, type JobActivity } from "@factory/core/activity";
import { useRunnerRealtime } from "./runner-realtime";
import { Time } from "./time";

export function JobActivityTimeline({ jobId, events, audit }: { jobId: string; events: readonly EventRow[]; audit: readonly AuditRow[] }) {
  const realtime = useRunnerRealtime();
  const streamed = realtime.snapshot?.activity as JobActivity[] | undefined;
  const rows = streamed && realtime.receivedAt
    ? streamed.filter(item => item.jobId === jobId)
    : [...events.flatMap(row => { const item = eventActivity(jobId, row); return item ? [item] : []; }), ...audit.map(auditActivity)]
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return <section className="flex flex-col gap-2.5 px-4.5 py-3.5">
    <h3 className="text-sm font-medium text-muted-foreground">Job activity <span className="text-xs">{realtime.live ? "Live" : "Offline / fallback"}</span></h3>
    {!rows.length && <p className="text-muted-foreground">No activity yet.</p>}
    <ol className="flex flex-col gap-3">{rows.map(item => <li key={item.id} className="text-sm">
      <div className="flex justify-between gap-2"><b className="font-medium">{item.kind.replaceAll("_", " ")}</b><span className="text-xs text-muted-foreground"><Time date={new Date(item.at)} /></span></div>
      <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.summary}</p>
      {item.refusal && <p className="text-destructive">Refused: {item.refusal}</p>}
    </li>)}</ol>
  </section>;
}
