import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@factory/storage/schema";
import { jobs } from "@factory/storage/schema";
import type { JobId } from "./sources/shapes";

export function qaBlock(question: string, answer: string) {
  const quote = (text: string) => text.trim().replace(/^/gm, "> ");
  return ["## Your question", "", quote(question), "", "## Answer", "", quote(answer)].join("\n");
}

/** The turn a resumed thread receives. */
export function resumeMessage(subject: string, question: string, answer: string, playbook: string) {
  return [
    `The reporter answered your question on ${subject}.`,
    "",
    `Continue the factory playbook (${playbook}) on this branch, treating the answer as the spec. Use report_work for progress, needs_human for another actionable question, and handoff with verified sha and evidenceEventId when complete.`,
    "",
    qaBlock(question, answer),
  ].join("\n");
}

/** Claims delivery only for the attempt and question that accepted this answer. */
export async function claimReplies(
  db: NodePgDatabase<typeof schema>,
  id: JobId,
  expected: { attempt: number; questionEventId: string | null },
  replyIds: readonly string[],
  answer: string,
  at: Date,
  /** Set when the thread that asked is gone: unlinks it and keeps the Q&A for a fresh thread. */
  relaunchContext?: string,
) {
  const claimed = await db
    .update(jobs)
    .set({
      delivered_reply_ids: sql`${jobs.delivered_reply_ids} || ${JSON.stringify(replyIds)}::jsonb`,
      answered_at: at,
      answer,
      updated_at: at,
      ...(relaunchContext
        ? { resume_context: relaunchContext, t3_thread_id: null, session_id: null, machine_id: null }
        : {}),
    })
    .where(
      and(
        eq(jobs.id, id),
        sql`${jobs.attention} is not null`,
        eq(jobs.attempt, expected.attempt),
        sql`${jobs.attention}->>'eventId' is not distinct from ${expected.questionEventId}`,
        sql`not (${jobs.delivered_reply_ids} ?| array[${sql.join(
          replyIds.map((r) => sql`${r}`),
          sql`, `,
        )}]::text[])`,
      ),
    )
    .returning({ key: jobs.key });
  return claimed.length > 0;
}
