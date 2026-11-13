import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { jobs, repoSettings } from "@factory/storage/schema";
import { fileInternalJob } from "@factory/core/internal-jobs";

const repo = `internal-regression/${randomUUID()}`;
const requestId = randomUUID();
const input = { requestId, repo, title: "Repair internal submission", description: "Keep a durable offline job." };
try {
  await db.insert(repoSettings).values({ repo, registration_status: "ready", updated_at: new Date(), updated_by: "regression" });
  const results = await Promise.all([fileInternalJob(db, input, "operator:test"), fileInternalJob(db, input, "operator:test")]);
  assert.deepEqual(results[0], results[1], "concurrent replay returns the same job identity");
  const stored = await db.select().from(jobs).where(eq(jobs.external_id, requestId));
  assert.equal(stored.length, 1, "concurrent submissions must not create duplicate work");
  assert.equal(stored[0]!.repo, repo);
  assert.equal(stored[0]!.stage, "queued", "submission survives while runner is offline");
  assert.equal(stored[0]!.machine_id, null);
  assert.equal(stored[0]!.source, "internal");
  assert.deepEqual(stored[0]!.source_state, { actor: "operator:test" });
  await assert.rejects(fileInternalJob(db, { ...input, title: "Different request content" }, "operator:test"), /different job submission/);
  await db.update(repoSettings).set({ enabled: false }).where(eq(repoSettings.repo, repo));
  await assert.rejects(fileInternalJob(db, { ...input, requestId: randomUUID() }, "operator:test"), /not a ready, enabled repository/);
  assert.deepEqual(await fileInternalJob(db, input, "operator:test"), results[0], "disabling a repo must not invalidate an accepted request receipt");
  console.log("Internal job concurrency, replay conflict, offline persistence, and disabled repository regressions passed");
} finally {
  await db.delete(jobs).where(eq(jobs.repo, repo));
  await db.delete(repoSettings).where(eq(repoSettings.repo, repo));
  await db.$client.end();
}
