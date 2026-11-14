import "./test-guard";
import assert from "node:assert/strict";
import { mock } from "bun:test";
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
mock.module("../apps/runner/src/harnesses", () => ({ readHarnesses: async () => [{ id: "t3-review", driver: "codex", name: "Isolated reviewer", enabled: true, models: [{ slug: "review-model", name: "Review" }] }] }));
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
  for (const scenario of ["wrong-verdict-sha", "changed-builder-sha", "dirty-reviewer", "changed-reviewer-head", "dirty-builder", "uncertain-delivery", "stop-during-read", "attempt-during-read", "passed-restart"] as const) {
    verdict = "PASS";
    sends = 0;
    const before = publications;
    const active: AttemptReview = structuredClone(review);
    active.state = scenario === "dirty-builder" ? "building" : scenario === "uncertain-delivery" ? "repairing" : scenario === "passed-restart" ? "passed" : "reviewing";
    if (active.state !== "passed") active.rounds[0] = { ...active.rounds[0]!, state: "running", result: undefined };
    if (scenario === "uncertain-delivery") active.delivery = { id: "crashed-delivery", state: "uncertain", message: "Repair" };
    if (scenario === "passed-restart") active.rounds[0]!.round = 2;
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "verifying", t3_thread_id: scenario === "passed-restart" ? active.builderThreadId : "reviewer", session_id: scenario === "passed-restart" ? active.builderSessionId : null, attempt_review: active }));
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
      assert.equal(settled!.stage, "pr", "durable PASS resumes publication after restart");
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
    active.policy.provider = "t3-review";
    active.state = "held";
    active.rounds[0] = { ...active.rounds[0]!, state: "launching", threadId: null, result: undefined };
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "verifying", attempt_review: active }));
    const commands: string[][] = [];
    hosts.forJob = () => ({ ...originalHost({ key }), run: async (_command, args) => {
      commands.push(args);
      return { stdout: JSON.stringify(args.includes("list") ? (ambiguous ? [{ threadId: "one" }, { threadId: "two" }] : [{ threadId: "one" }]) : { thread: { branch: `review/${key}-a2-r1` } }), stderr: "" };
    } });
    await reviewJobs();
    const [settled] = await db.select().from(jobs).where(eq(jobs.key, key));
    assert.equal(settled!.attempt_review!.state, ambiguous ? "held" : "reviewing");
    assert.equal(settled!.attempt_review!.rounds[0]!.threadId, ambiguous ? null : "one", "restart adopts only uniquely owned reviewer");
    assert.ok(commands.every(args => !args.includes("create") && !args.includes("send")), "launch reservation recovery never starts a replacement session");
    await db.delete(jobs).where(eq(jobs.key, key));
  }
  {
    const active = structuredClone(review);
    active.policy.provider = "t3-review";
    active.state = "reviewing";
    active.rounds[0] = { ...active.rounds[0]!, state: "launching", threadId: null, result: undefined };
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "verifying", attempt_review: active }));
    hosts.forJob = () => ({ ...originalHost({ key }), run: async (_command, args) => {
      if (args.includes("list")) {
        await db.update(jobs).set({ stop: requestedStop({ at: new Date(), by: "regression", reason: "Stop while recovering launch", reopen: false }) }).where(eq(jobs.key, key));
        return { stdout: JSON.stringify([{ threadId: "late-reviewer" }]), stderr: "" };
      }
      return { stdout: JSON.stringify({ thread: { branch: `review/${key}-a2-r1` } }), stderr: "" };
    } });
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
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "verifying", attempt_review: active }));
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
    active.policy = { enabled: true, provider: "t3-review", model: "review-model" };
    active.state = "building";
    active.rounds = [];
    await db.insert(jobs).values(internalJob(key, key, { repo: repository, machine_id: machine.id, attempt: 2, stage: "verifying", t3_thread_id: "builder", attempt_review: active }));
    threads.read = async () => ({ state: "stopped", status: "completed", checkout: "builder-checkout", lastMessage: "Ready" });
    let launches = 0;
    hosts.forJob = () => ({ ...originalHost({ key }), run: async (_command, args) => {
      if (args.includes("start")) { launches++; return { stdout: JSON.stringify({ threadId: "immediate-reviewer" }), stderr: "" }; }
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
