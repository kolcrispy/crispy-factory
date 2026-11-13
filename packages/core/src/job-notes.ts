import { db } from "@factory/storage/client";
import { events } from "@factory/storage/schema";
import type { Job } from "./sources/types";

export async function recordJobNote(job: Job, key: string, body: string) {
  await db.insert(events).values({
    event_id: `note:${job.id}:${job.attempt}:${key}`,
    session_id: job.session_id ?? `job:${job.id}:${job.attempt}`,
    kind: "note", at: new Date(), job_key: job.key,
    payload: { body, attempt: job.attempt },
  }).onConflictDoNothing();
}
