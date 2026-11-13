import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { jobs, events } from "@factory/storage/schema";
import { jobId } from "@factory/core/sources/shapes";
import { retryJob } from "@factory/runner/inbox";

const externalId = randomUUID();
const id = jobId("internal", externalId);
const key = `RETRY-${externalId}`;
const detail = { actor: "regression", attempt: 1, note: "Use staging" };
try {
  await db.insert(jobs).values({ id, source: "internal", external_id: externalId, key, title: "Retry isolation", repo: "test/repo", url: "/list", source_state: { actor: "regression" }, writeback: {}, stage: "failed", stage_summary: "Tests failed", t3_thread_id: "pending:1", claimed_at: new Date(), updated_at: new Date(), delivered_reply_ids: ["old-answer"], delivered_feedback_ids: ["old-feedback"], answer: "Old answer", pr_url: "https://github.com/test/repo/pull/1" });
  assert.ok("refused" in await retryJob(id, detail), "pending launch ownership blocks a new attempt");
  await db.update(jobs).set({ t3_thread_id: null }).where(eq(jobs.id, id));
  const results = await Promise.all([retryJob(id, detail), retryJob(id, detail)]);
  assert.ok(results.some(result => "started" in result && result.started === 2));
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  assert.equal(row!.attempt, 2, "concurrent retry creates one attempt, not two");
  assert.equal(row!.stage, "queued");
  assert.equal(row!.previous_failure, "Tests failed");
  assert.deepEqual(row!.attempt_note, { attempt: 2, text: "Use staging" });
  assert.deepEqual([row!.pr_url, row!.answer, row!.machine_id, row!.session_id], [null, null, null, null]);
  assert.deepEqual([row!.delivered_reply_ids, row!.delivered_feedback_ids], [[], []]);
  assert.deepEqual(await retryJob(id, detail), { started: 2 }, "request replay does not increment the attempt");
  console.log("Internal retry pending ownership, concurrent replay, and attempt reset regressions passed");
} finally {
  await db.delete(events).where(eq(events.job_key, key));
  await db.delete(jobs).where(eq(jobs.id, id));
  await db.$client.end();
}
