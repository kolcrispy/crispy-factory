import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@factory/storage/client";
import { jobs, type IntentRow } from "@factory/storage/schema";
import { resumeAnswered } from "./ops";

const detailSchema = z.object({ body: z.string().min(1), attempt: z.number().int().positive(), questionEventId: z.string().nullable() });

/** Intent completion reflects this answer, not whether some other waiting job resumed. */
export async function deliverAnswer(intent: IntentRow) {
  const detail = detailSchema.parse(JSON.parse(intent.detail ?? "null"));
  const [before] = await db.select().from(jobs).where(eq(jobs.id, intent.job_id!));
  if (!before) return { answer: { refused: "This job no longer exists." } };
  if (before.delivered_reply_ids.includes(intent.id)) return { answer: { delivered: before.key } };
  if (before.attempt !== detail.attempt || before.stage_event_id !== detail.questionEventId || before.stage !== "waiting") return { answer: { refused: "The job is no longer waiting for the question you answered." } };
  await resumeAnswered();
  const [after] = await db.select().from(jobs).where(eq(jobs.id, intent.job_id!));
  if (after?.delivered_reply_ids.includes(intent.id)) return { answer: { delivered: after.key } };
  throw new Error("Answer remains queued for runner delivery.");
}
