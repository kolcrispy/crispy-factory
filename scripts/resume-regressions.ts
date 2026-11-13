import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { jobs } from "@factory/storage/schema";
import { jobId } from "@factory/core/sources/shapes";
import { claimReplies } from "@factory/core/resume";
import { deliverAnswer } from "@factory/runner/answers";
import { describeOutcome } from "@factory/core/inbox-actions";
import type { IntentRow } from "@factory/storage/schema";

const externalId = randomUUID();
const id = jobId("internal", externalId);
const now = new Date();
const expected = { attempt: 1, questionEventId: "question-1" };
try {
  await db.insert(jobs).values({ id, source: "internal", external_id: externalId, key: `RESUME-${externalId}`, title: "Answer isolation", url: "/list", repo: "test/repo", stage: "waiting", stage_event_id: expected.questionEventId, claimed_at: now, updated_at: now, source_state: { actor: "regression" }, writeback: {} });
  assert.equal(await claimReplies(db, id, { ...expected, attempt: 2 }, ["stale-attempt"], "Wrong attempt", now), false);
  const staleIntent = { id: "stale-answer", kind: "answer", job_id: id, detail: JSON.stringify({ body: "Old answer", attempt: 2, questionEventId: "question-1" }) } as IntentRow;
  const staleResult = await deliverAnswer(staleIntent);
  assert.ok("refused" in staleResult.answer, "a stale answer must not report delivery success");
  assert.equal(describeOutcome("answer", JSON.stringify(staleResult)).status, "failed");
  assert.equal(await claimReplies(db, id, { ...expected, questionEventId: "question-0" }, ["stale-question"], "Wrong question", now), false);
  assert.equal(await claimReplies(db, id, expected, ["answer-1"], "Use layout B", now), true);
  assert.equal(await claimReplies(db, id, expected, ["answer-1"], "Use layout B", now), false, "replay must not redeliver");
  await db.update(jobs).set({ stage_event_id: "question-2", t3_thread_id: "dead-thread", machine_id: "old-machine", session_id: "old-session" }).where(eq(jobs.id, id));
  assert.equal(await claimReplies(db, id, expected, ["late-answer"], "Old question", now), false, "a new question must invalidate answers already selected by a runner");
  assert.equal(await claimReplies(db, id, { ...expected, questionEventId: "question-2" }, ["answer-2"], "Proceed", now, "## Q&A"), true);
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  assert.deepEqual(row!.delivered_reply_ids, ["answer-1", "answer-2"]);
  assert.deepEqual([row!.t3_thread_id, row!.machine_id, row!.session_id], [null, null, null], "dead thread answer atomically releases relaunch ownership");
  assert.equal(row!.resume_context, "## Q&A");
  assert.equal(row!.answer, "Proceed");
  console.log("Internal answer replay, attempt/question isolation, and dead-thread relaunch regressions passed");
} finally {
  await db.delete(jobs).where(eq(jobs.id, id));
  await db.$client.end();
}
