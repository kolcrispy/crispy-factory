import "./test-guard";
import assert from "node:assert/strict";
import { resolveReviewPolicy, reviewAllowsPublication, reviewConfigurationProblem, reviewVerdictSchema, type AttemptReview } from "@factory/core/review";

const builder = { provider: "omp", model: "builder-model" };
assert.deepEqual(resolveReviewPolicy(builder), { enabled: true, ...builder });
assert.deepEqual(resolveReviewPolicy(builder, { provider: "codex", model: "review-model" }, { enabled: false }, { enabled: true }), {
  enabled: true, provider: "codex", model: "review-model",
});
assert.deepEqual(resolveReviewPolicy(builder, { model: "global-model" }, { provider: "codex" }, { model: "job-model" }), {
  enabled: true, provider: "codex", model: "job-model",
});
assert.equal(reviewConfigurationProblem({ enabled: false, ...builder }, null), null);
assert.match(reviewConfigurationProblem({ enabled: true, ...builder }, [])!, /not available/);
const sha = "a".repeat(40);
const other = "b".repeat(40);
const finding = { severity: "blocking" as const, file: "src/a.ts", line: 3, title: "Incorrect result", impact: "Valid requests lose data", reason: "The empty branch returns before persistence" };
assert.equal(reviewVerdictSchema.safeParse({ verdict: "PASS", sha, summary: "Checked", findings: [finding] }).success, false);
assert.equal(reviewVerdictSchema.safeParse({ verdict: "FIX", sha, summary: "Fix needed", findings: [] }).success, false);
const result = reviewVerdictSchema.parse({ verdict: "PASS", sha, summary: "No blocking findings", findings: [] });
const review: AttemptReview = { attempt: 2, policy: { enabled: true, ...builder }, state: "passed", builderThreadId: "builder", builderSessionId: "session", automaticRepairs: 0,
  rounds: [{ round: 1, sha, base: other, threadId: "reviewer", sessionId: "review-session", checkout: "review-checkout", state: "complete", startedAt: 1, result }] };
assert.equal(reviewAllowsPublication(review, 2, sha), true);
assert.equal(reviewAllowsPublication(review, 2, other), false, "PASS never authorizes a changed revision");
assert.equal(reviewAllowsPublication(review, 3, sha), false, "PASS never authorizes another attempt");
assert.equal(reviewAllowsPublication({ ...review, state: "held" }, 2, sha), false);
assert.equal(reviewAllowsPublication({ ...review, policy: { ...review.policy, enabled: false }, state: "skipped" }, 2, sha), true);
assert.equal(reviewAllowsPublication(null, 1, sha), true, "Existing attempts retain their old contract");

const { db } = await import("@factory/storage/client");
const { jobs } = await import("@factory/storage/schema");
const { ingest } = await import("@factory/core/ingest");
const { internalJob } = await import("./fixtures");
const { eq } = await import("drizzle-orm");
const key = "review-gate-regression";
const row = internalJob(key, key, { stage: "verifying", attempt: 2, session_id: "builder-session", attempt_review: { ...review, state: "building", builderSessionId: "builder-session", rounds: [] } });
await db.insert(jobs).values(row);
try {
  const outcome = await ingest(db, [{ kind: "stage", eventId: "review-gate-early-pr", sessionId: "builder-session", at: Date.now(), jobKey: key, branch: `factory/${key}-a2`, stage: "pr", summary: "Premature publication", prUrl: "https://github.com/owner/repo/pull/1" }]);
  assert.ok(JSON.stringify(outcome).includes("Independent review PASS"));
  assert.equal((await db.select().from(jobs).where(eq(jobs.key, key)))[0]!.stage, "verifying");
} finally { await db.delete(jobs).where(eq(jobs.key, key)); }
const { reviewJobs, handleReviewAction } = await import("@factory/runner/review");
const { threads } = await import("@factory/runner/threads");
const { hosts } = await import("@factory/core/host");
const { thisMachine } = await import("@factory/runner/heartbeat");
const { repoSettings } = await import("@factory/storage/schema");
const { github } = await import("@factory/integrations/github/pulls");
const originalCreate = github.createPull;
let publications = 0;
github.createPull = async () => { publications++; return { url: "https://github.com/review-regression/isolated/pull/1" }; };
const machine = await thisMachine();
const originalRead = threads.read;
const originalSend = threads.send;
const originalHost = hosts.forJob;
const repository = "review-regression/isolated";
await db.insert(repoSettings).values({ repo: repository, checkout_path: "review-root", default_branch: "main", updated_by: "regression", updated_at: new Date(0) });
let verdict = "BLOCKED";
let sends = 0;
threads.read = async () => ({ state: "stopped", status: "completed", checkout: "review-checkout", lastMessage: JSON.stringify({ sha, verdict, summary: "Concrete review outcome", findings: verdict === "FIX" ? [{ severity: "blocking", file: "src/a.ts", title: "Wrong result", impact: "Incorrect consumer output", reason: "Observed wrong branch" }] : [] }) });
threads.send = async () => { sends++; };
hosts.forJob = () => ({ ...originalHost({ key }), run: async (_command, args) => ({ stdout: args.includes("status") ? "" : sha, stderr: "" }) });
try {
  for (const [outcome, repairs, expected, deliveries] of [["PASS", 0, "passed", 0], ["BLOCKED", 0, "held", 0], ["FIX", 0, "repairing", 1], ["FIX", 2, "held", 0]] as const) {
    verdict = outcome;
    sends = 0;
    const active = { ...review, state: "reviewing" as const, automaticRepairs: repairs, rounds: [{ ...review.rounds[0]!, state: "running" as const, result: undefined }] };
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "verifying", t3_thread_id: "reviewer", attempt_review: active }));
    await reviewJobs();
    const [settled] = await db.select().from(jobs).where(eq(jobs.key, key));
    assert.equal(settled!.attempt_review!.state, expected, `${outcome} with ${repairs} repairs`);
    assert.equal(sends, deliveries, "only bounded FIX delivers a builder repair");
    assert.equal(settled!.stage, outcome === "PASS" ? "pr" : outcome === "FIX" && repairs < 2 ? "implementing" : "verifying");
    assert.equal(publications, 1, "only PASS publishes a PR; no repair or held verdict publishes");
    if (outcome === "BLOCKED") {
      const intent = { id: "review-action:owner-recovery", job_id: settled!.id, detail: JSON.stringify({ requestId: "a1234567-1234-4123-8123-123456789012", jobId: settled!.id, attempt: 2, action: "review", body: "" }) };
      assert.deepEqual(await handleReviewAction(intent), { accepted: "review" });
      assert.deepEqual(await handleReviewAction(intent), { accepted: "review" }, "replaying accepted recovery never launches or delivers twice");
    }
    await db.delete(jobs).where(eq(jobs.key, key));
  }
} finally {
  threads.read = originalRead;
  threads.send = originalSend;
  hosts.forJob = originalHost;
  github.createPull = originalCreate;
  await db.delete(jobs).where(eq(jobs.key, key));
  await db.delete(repoSettings).where(eq(repoSettings.repo, repository));
}
console.log("review policy and revision-bound verdict regressions passed");
