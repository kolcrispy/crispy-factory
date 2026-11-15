import "./test-guard";
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { resolveReviewPolicy, reviewAllowsPublication, reviewConfigurationProblem, reviewVerdictSchema, type AttemptReview } from "@factory/core/review";

const builder = { provider: "omp", model: "builder-model" };
assert.deepEqual(resolveReviewPolicy(builder), { enabled: true, ...builder });
assert.deepEqual(resolveReviewPolicy(builder, { provider: "omp", model: "review-model" }, { enabled: false }, { enabled: true }), {
  enabled: true, provider: "omp", model: "review-model",
});
assert.deepEqual(resolveReviewPolicy(builder, { model: "global-model" }, { provider: "omp" }, { model: "job-model" }), {
  enabled: true, provider: "omp", model: "job-model",
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
const row = internalJob(key, key, { stage: "building", attempt: 2, session_id: "builder-session", attempt_review: { ...review, state: "building", builderSessionId: "builder-session", rounds: [] } });
await db.insert(jobs).values(row);
try {
  const outcome = await ingest(db, [{ kind: "stage", eventId: "review-gate-early-pr", sessionId: "builder-session", at: Date.now(), jobKey: key, branch: `factory/${key}-a2`, stage: "ready", summary: "Premature publication", prUrl: "https://github.com/owner/repo/pull/1" }]);
  assert.ok(JSON.stringify(outcome).includes("Independent review PASS"));
  assert.equal((await db.select().from(jobs).where(eq(jobs.key, key)))[0]!.stage, "building");
} finally { await db.delete(jobs).where(eq(jobs.key, key)); }
mock.module("../apps/runner/src/harnesses", () => ({ readHarnesses: async () => [{ id: "omp", driver: "omp", name: "OMP", enabled: true, models: [{ slug: "review-model", name: "Review" }] }] }));
let recoverReviewer = async (): Promise<string> => { throw new Error("Ownership unavailable"); };
let startReviewer = async (): Promise<string> => { throw new Error("Unexpected replacement launch"); };
mock.module("../apps/runner/src/omp", () => ({ recoverOmp: () => recoverReviewer(), startOmp: () => startReviewer(), isOmp: (id: string) => id.startsWith("omp:"), readOmp: async () => { throw new Error("Unexpected runtime read"); }, sendOmp: async () => {}, ompSubagents: async () => [], interruptOmp: async () => ({ kind: "requested" }), reconcileOmpUsage: async () => {}, closeOmpSessions: async () => {} }));
const { reviewJobs, handleReviewAction } = await import("@factory/runner/review");
const { threads } = await import("@factory/runner/threads");
const { hosts } = await import("@factory/core/host");
const { thisMachine } = await import("@factory/runner/heartbeat");
const { repoSettings } = await import("@factory/storage/schema");
const { github } = await import("@factory/integrations/github/pulls");
const { requestedStop } = await import("@factory/core/stop");
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
const { OmpRpcTimeout } = await import("@factory/integrations/omp-rpc");
try {
  const pollingReview: AttemptReview = { ...structuredClone(review), state: "building", rounds: [] };
  await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "building", execution_id: "builder", attempt_review: pollingReview }));
  threads.read = async () => { throw new OmpRpcTimeout("get_state"); };
  await reviewJobs();
  const [polling] = await db.select().from(jobs).where(eq(jobs.key, key));
  assert.equal(polling!.attempt_review!.state, "building", "a status read timeout must not permanently hold a still-owned builder");
  assert.equal(polling!.attention, null, "a transient status read does not require owner recovery");
  assert.equal(publications, 0, "an unavailable status cannot authorize publication");
  await db.delete(jobs).where(eq(jobs.key, key));
  threads.read = async () => ({ state: "stopped", status: "completed", checkout: "review-checkout", lastMessage: JSON.stringify({ sha, verdict, summary: "Concrete review outcome", findings: verdict === "FIX" ? [finding] : [] }) });
  for (const [outcome, repairs, expected, deliveries] of [["PASS", 0, "passed", 0], ["BLOCKED", 0, "held", 0], ["FIX", 0, "repairing", 1], ["FIX", 2, "held", 0]] as const) {
    verdict = outcome;
    sends = 0;
    const active = { ...review, state: "reviewing" as const, automaticRepairs: repairs, rounds: [{ ...review.rounds[0]!, state: "running" as const, result: undefined }] };
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "building", execution_id: "reviewer", attempt_review: active,
      builder_handoff: { eventId: "builder-handoff", at: Date.now(), attempt: 2, sha, evidenceEventId: "builder-proof", summary: "Verified" } }));
    await reviewJobs();
    const [settled] = await db.select().from(jobs).where(eq(jobs.key, key));
    assert.equal(settled!.attempt_review!.state, expected, `${outcome} with ${repairs} repairs`);
    assert.equal(sends, deliveries, "only bounded FIX delivers a builder repair");
    assert.equal(settled!.stage, outcome === "PASS" ? "ready" : outcome === "FIX" && repairs < 2 ? "building" : "reviewing");
    assert.equal(publications, 1, "only PASS publishes a PR; no repair or held verdict publishes");
    if (outcome === "BLOCKED") {
      const intent = { id: "review-action:owner-recovery", job_id: settled!.id, detail: JSON.stringify({ requestId: "a1234567-1234-4123-8123-123456789012", jobId: settled!.id, attempt: 2, action: "review", body: "" }) };
      assert.deepEqual(await handleReviewAction(intent), { accepted: "review" });
      assert.deepEqual(await handleReviewAction(intent), { accepted: "review" }, "replaying accepted recovery never launches or delivers twice");
    }
    await db.delete(jobs).where(eq(jobs.key, key));
  }
  for (const scenario of ["wrong-verdict-sha", "changed-builder-sha", "dirty-reviewer", "changed-reviewer-head", "dirty-builder", "uncertain-delivery", "stop-during-read", "attempt-during-read", "passed-restart"] as const) {
    verdict = "PASS";
    sends = 0;
    const before: number = publications;
    const active: AttemptReview = structuredClone(review);
    active.state = scenario === "dirty-builder" ? "building" : scenario === "uncertain-delivery" ? "repairing" : scenario === "passed-restart" ? "passed" : "reviewing";
    if (active.state !== "passed") active.rounds[0] = { ...active.rounds[0]!, state: "running", result: undefined };
    if (scenario === "uncertain-delivery") active.delivery = { id: "crashed-delivery", state: "uncertain", message: "Repair" };
    if (scenario === "passed-restart") active.rounds[0]!.round = 2;
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "reviewing", execution_id: scenario === "passed-restart" ? active.builderThreadId : "reviewer", session_id: scenario === "passed-restart" ? active.builderSessionId : null, attempt_review: active,
      builder_handoff: { eventId: "scenario-handoff", at: Date.now(), attempt: 2, sha, evidenceEventId: "scenario-proof", summary: "Verified" },
    }));
    threads.read = async () => {
      if (scenario === "stop-during-read") await db.update(jobs).set({ stop: requestedStop({ at: new Date(), by: "regression", reason: "Owner stop", reopen: false }) }).where(eq(jobs.key, key));
      if (scenario === "attempt-during-read") await db.update(jobs).set({ attempt: 3 }).where(eq(jobs.key, key));
      return { state: "stopped", status: "completed", checkout: "review-checkout", lastMessage: JSON.stringify({ sha: scenario === "wrong-verdict-sha" ? other : sha, verdict: "PASS", summary: "Reviewed", findings: [] }) };
    };
    hosts.forJob = () => ({ ...originalHost({ key }), run: async (_command, args) => ({ stdout: args.includes("status") ? (["dirty-reviewer", "dirty-builder"].includes(scenario) ? " M source.ts" : "") : scenario === "changed-builder-sha" && args.includes("review-root") || scenario === "changed-reviewer-head" && args.includes("HEAD") ? other : sha, stderr: "" }) });
    await reviewJobs();
    await reviewJobs(); // A later runner tick must not replay uncertain side effects.
    const [settled] = await db.select().from(jobs).where(eq(jobs.key, key));
    if (scenario === "passed-restart") {
      assert.equal(settled!.stage, "ready", "durable PASS resumes publication after restart");
      assert.equal(publications, before + 1);
    } else {
      assert.equal(publications, before, `${scenario} cannot publish`);
      assert.equal(sends, 0, `${scenario} cannot redeliver builder repair`);
      if (!["stop-during-read", "attempt-during-read"].includes(scenario)) assert.equal(settled!.attempt_review!.state, "held", scenario);
    }
    await db.delete(jobs).where(eq(jobs.key, key));
  }
  for (const ambiguous of [false, true]) {
    const active = structuredClone(review);
    active.policy.provider = "omp";
    active.state = "held";
    active.rounds[0] = { ...active.rounds[0]!, state: "launching", threadId: null, result: undefined };
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "building", attempt_review: active }));
    recoverReviewer = async () => { if (ambiguous) throw new Error("Ambiguous ownership"); return "omp:review:owned:2:1"; };
    await reviewJobs();
    const [settled] = await db.select().from(jobs).where(eq(jobs.key, key));
    assert.equal(settled!.attempt_review!.state, ambiguous ? "held" : "reviewing");
    assert.equal(settled!.attempt_review!.rounds[0]!.threadId, ambiguous ? null : "omp:review:owned:2:1", "restart adopts only confirmed owned reviewer");
    await db.delete(jobs).where(eq(jobs.key, key));
  }
  {
    const active = structuredClone(review);
    active.policy.provider = "omp";
    active.state = "reviewing";
    active.rounds[0] = { ...active.rounds[0]!, state: "launching", threadId: null, result: undefined };
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "building", attempt_review: active }));
    recoverReviewer = async () => {
      await db.update(jobs).set({ stop: requestedStop({ at: new Date(), by: "regression", reason: "Stop while recovering launch", reopen: false }) }).where(eq(jobs.key, key));
      return "omp:review:late:2:1";
    };
    const before = publications;
    await reviewJobs();
    const [settled] = await db.select().from(jobs).where(eq(jobs.key, key));
    assert.equal(settled!.attempt_review!.rounds[0]!.state, "launching", "stop wins over stale recovered launch ownership");
    assert.equal(settled!.attempt_review!.rounds[0]!.threadId, null);
    assert.equal(publications, before);
    await db.delete(jobs).where(eq(jobs.key, key));
  }
  {
    const active = structuredClone(review);
    active.state = "reviewing";
    active.automaticRepairs = 0;
    active.rounds[0] = { ...active.rounds[0]!, state: "running", result: undefined };
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "building", attempt_review: active }));
    threads.read = async () => ({ state: "stopped", status: "completed", checkout: "review-checkout", lastMessage: JSON.stringify({ sha, verdict: "FIX", summary: "Fix blocker", findings: [finding] }) });
    hosts.forJob = () => ({ ...originalHost({ key }), run: async (_command, args) => ({ stdout: args.includes("status") ? "" : sha, stderr: "" }) });
    let deliveries = 0;
    threads.send = async () => { deliveries++; throw new Error("Connection lost after delivery"); };
    await reviewJobs();
    await reviewJobs();
    const [settled] = await db.select().from(jobs).where(eq(jobs.key, key));
    assert.equal(settled!.attempt_review!.state, "held");
    assert.equal(settled!.attempt_review!.delivery!.state, "uncertain");
    assert.equal(deliveries, 1, "restart after ambiguous delivery never sends repair twice");
    await db.delete(jobs).where(eq(jobs.key, key));
  }
  {
    const active = structuredClone(review);
    active.policy = { enabled: true, provider: "omp", model: "review-model" };
    active.state = "building";
    active.rounds = [];
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "building", execution_id: "builder", attempt_review: active,
      builder_handoff: { eventId: "builder-handoff", at: Date.now(), attempt: 2, sha, evidenceEventId: "builder-proof", summary: "Verified" },
      evidence: { sha, attempt: 2, clean: true, producer: "agent", source: "package", at: new Date().toISOString(), checks: [{ name: "test", passed: true, exitCode: 0, durationMs: 1 }] },
    }));
    threads.read = async () => ({ state: "stopped", status: "completed", checkout: "builder-checkout", lastMessage: "Ready" });
    let launches = 0;
    startReviewer = async () => { launches++; return "immediate-reviewer"; };
    hosts.forJob = () => ({ ...originalHost({ key }), run: async (_command, args) => {
      return { stdout: args.includes("status") ? "" : sha, stderr: "" };
    } });
    await reviewJobs();
    const [settled] = await db.select().from(jobs).where(eq(jobs.key, key));
    assert.equal(settled!.attempt_review!.rounds[0]!.threadId, "immediate-reviewer", "a committed builder handoff launches review in the same pass");
    assert.equal(launches, 1);
    threads.read = async () => ({ state: "running", status: null, checkout: "review-checkout", lastMessage: null });
    await reviewJobs();
    assert.equal(launches, 1, "subsequent wake never duplicates the reviewer");
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
