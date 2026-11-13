import { join } from "node:path";

// The factory runner owns local T3, git and GitHub operations. PostgreSQL intents are
// authoritative; polling and startup reconciliation recover missed work idempotently.
//   bun apps/runner/src/index.ts            run in the foreground
//   bun apps/runner/src/index.ts --once     reconcile once and exit

process.chdir(join(import.meta.dirname, "../../.."));
await import("@factory/platform/environment");

const { and, asc, eq, isNull } = await import("drizzle-orm");
const { db } = await import("@factory/storage/client");
const { acquireRunnerOwnership } = await import("./ownership");
const releaseOwnership = await acquireRunnerOwnership(db.$client, error => {
  console.error(JSON.stringify({ event: "ownership:lost", error: error.message }));
  process.exit(1);
});
const { intents, jobs } = await import("@factory/storage/schema");
const ops = await import("./ops");
const { createBeat, inventoryCollectors, systemCollectors, thisMachine } = await import("./heartbeat");
const { closeBroadcast, deliveryFor, expirePairings, INTENT_ATTEMPTS, leaseIntent, loggable, receiptIntent, recordReceipt } = await import("./intents");
const { launchQueued } = await import("./launch");
const { openT3 } = await import("./pairing");
const { recheckScheduler } = await import("./recheck");
const { everyAtMost, serialQueue } = await import("./queue");
const { isolated, reconcile } = await import("./reconcile");
const { inferUntracked } = await import("./untracked");
const { flushLocalOutbox } = await import("./outbox");
const { approveMerge, decideMerges } = await import("./merge-decision");
const { closeJob, forwardReview, requestChanges, retryJob } = await import("./inbox");
const { confirmStops, retryStop } = await import("./stops");
const { approveDetailSchema, closeDetailSchema, feedbackDetailSchema, retryDetailSchema } = await import("@factory/core/inbox");
const { deliverAnswer } = await import("./answers");
const { watchMerges } = await import("./post-merge");
const { refreshGithubSnapshots } = await import("./github-snapshot");
const { verificationsSettled } = await import("./verify");
type IntentRow = typeof intents.$inferSelect;
const { startReportServer } = await import("./report-server");
const { prepareRepository } = await import("./repository-registration");
const { wireHarnessReporting } = await import("./harness-wiring");
const reportServer = startReportServer(ops.config.ingestUrl, ops.config.secret);

const machine = await thisMachine();

const log = (event: string, detail: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

const logWorktree = (check: Record<string, unknown>) => log("worktree", check);

const queue = serialQueue(log);
// A backstop: a stray rejection is logged instead of taking the daemon down.
process.on("unhandledRejection", (reason) =>
  log("unhandledRejection", { error: reason instanceof Error ? reason.message : String(reason) }),
);
const serial = queue.serial;
let stopping = false;
const recheckTimers = new Set<ReturnType<typeof setTimeout>>();

/** Launches what this machine has room for, then tells each source about the jobs it now holds. */
/**
 * Write-back for every caller. A job whose source item is gone is logged once and then skipped, and
 * a failing write-back is returned for the log and the timer, never thrown, so the intent or timer
 * pass that asked for it succeeds on its own work.
 */
const writeBackPass = () => ops.acknowledgeStages();

const launchAndAnnounce = () => launchQueued(logWorktree).then(launched => ({ launched }));

async function handle(intent: IntentRow) {
  // Each step reaches a source only where it needs one, so a source outage does not block the rest.
  switch (intent.kind) {
    case "claim":
      return { queued: await ops.queuedJobs(), ...(await launchAndAnnounce()) };
    case "stop": {
      if (intent.id.startsWith("panel:stop:")) {
        const detail = JSON.parse(intent.detail ?? "null");
        if (!detail || typeof detail.actor !== "string" || !Number.isInteger(detail.attempt) || typeof detail.reason !== "string") throw new Error("Invalid operator stop intent.");
        return { stop: await ops.stopJob(intent.job_id!, detail.reason || "operator requested stop", { actor: detail.actor, attempt: detail.attempt }) };
      }
      return { stop: await ops.stopJob(intent.job_id!, intent.detail ?? "stopped in its source") };
    }
    case "answer":
      return { ...(await deliverAnswer(intent)), ...(await launchAndAnnounce()) };
    case "merged":
      return { merged: await ops.checkPullRequests(), synced: await writeBackPass() };
    case "recheck_conflicts":
      return { recheck: recheck.request() };
    case "open_t3":
      return openT3(intent.job_id!);
    case "approve_merge":
      return { approval: await approveMerge(intent.job_id!, approveDetailSchema.parse(JSON.parse(intent.detail ?? "null"))), synced: await writeBackPass() };
    case "request_changes": {
      const feedback = feedbackDetailSchema.parse(JSON.parse(intent.detail ?? "null"));
      if (feedback.from === "panel") return { changes: await requestChanges(intent.job_id, feedback) };
      // A review its job can't take yet fails this try, so the intent stays open for the retry.
      const changes = await forwardReview(intent, feedback, machine.id);
      return "waiting" in changes ? { error: `waiting: ${changes.waiting}` } : { changes };
    }
    case "close_job":
      return { close: await closeJob(intent.job_id!, closeDetailSchema.parse(JSON.parse(intent.detail ?? "null"))), synced: await writeBackPass() };
    case "onboard_repo":
      return { registration: await prepareRepository(intent.detail!, ops.config.factory.workRoot) };
    case "retry_stop":
      return { retry: await retryStop(intent.job_id!), synced: await writeBackPass() };
    case "retry_job": {
      const attempt = await retryJob(intent.job_id!, retryDetailSchema.parse(JSON.parse(intent.detail ?? "null")));
      return { attempt, ...("started" in attempt ? await launchAndAnnounce() : {}) };
    }
    default: {
      const unhandled: never = intent.kind;
      throw new Error(`no handler for intent ${String(unhandled)}`);
    }
  }
}

const recheck = recheckScheduler({
  settled: ops.pullRequestsSettled,
  check: ops.checkPullRequests,
  enqueue: (name, step) => { if (!stopping) void serial(name, step); },
  schedule: (run, ms) => {
    if (stopping) return;
    const timer = setTimeout(() => {
      recheckTimers.delete(timer);
      if (!stopping) run();
    }, ms);
    recheckTimers.add(timer);
  },
  now: Date.now,
});

const inProgress = new Set<string>();
type OpenIntent = { intent: IntentRow; owner: string | null };

function takeIntents(rows: readonly OpenIntent[]) {
  if (stopping) return;
  for (const { intent, owner } of rows) {
    if (intent.handled_at || inProgress.has(intent.id)) continue;
    // Every later snapshot repeats the open intents; a failed one waits for its retry time.
    if (intent.retry_at && intent.retry_at.getTime() > Date.now()) continue;
    const delivery = deliveryFor(intent.kind, owner, machine.id);
    if (delivery === "skip") continue;
    // The lease decides; this only spares a queue step while a lease is live.
    if (delivery === "lease" && intent.lease_until && intent.lease_until.getTime() > Date.now()) continue;
    inProgress.add(intent.id);
    const step: () => Promise<unknown> = delivery === "receipt" ? () => runBroadcast(intent) : () => runIntent(intent);
    // Cleared once the queue is done with the step, even if the step timed out and still runs.
    void serial(`intent:${intent.kind}`, step).finally(() => inProgress.delete(intent.id));
  }
}

async function runIntent(intent: IntentRow) {
  if (!(await leaseIntent(intent.id, machine.id))) return { id: intent.id, skipped: "leased by another machine" };
  const latencyMs = Date.now() - intent.created_at.getTime();
  const result = await handle(intent).catch((error: unknown) => ({ error: String(error) }));
  // A failed intent stays open and the timer retries it, so a source or T3 hiccup cannot eat a
  // stop. After its kind's INTENT_ATTEMPTS it is closed with the error kept in result.
  const failed = "error" in result;
  const attempts = intent.attempts + 1;
  await db
    .update(intents)
    .set({
      attempts,
      handled_at: failed && attempts < INTENT_ATTEMPTS[intent.kind] ? null : new Date(),
      // 30 s, 1 min, 2 min, ... then every 30 min: about a day of retries before it gives up.
      retry_at: failed ? new Date(Date.now() + Math.min(30_000 * 2 ** (attempts - 1), 1_800_000)) : null,
      result: JSON.stringify(result),
      // A retry may go to any machine the route allows; a handled intent keeps the one that handled it.
      leased_by: failed ? null : machine.id,
      lease_until: null,
    })
    .where(and(eq(intents.id, intent.id), eq(intents.leased_by, machine.id)));
  return { id: intent.id, job: intent.job_id, latencyMs, attempts, ...loggable(intent.kind, result) };
}

/**
 * A broadcast runs once per machine; the receipt is taken first, so a replay on this machine only
 * tries to close it. It stays open until every online machine has a receipt, or it expires.
 */
async function runBroadcast(intent: IntentRow) {
  const fresh = await receiptIntent(intent.id, machine.id);
  const result = fresh ? await handle(intent).catch((error: unknown) => ({ error: String(error) })) : undefined;
  if (fresh) await recordReceipt(intent.id, machine.id, result);
  await closeBroadcast(intent.id);
  return { id: intent.id, receipt: fresh ? "taken" : "already taken", ...result };
}

async function openIntents(): Promise<OpenIntent[]> {
  return db
    .select({ intent: intents, owner: jobs.machine_id })
    .from(intents)
    .leftJoin(jobs, eq(jobs.id, intents.job_id))
    .where(isNull(intents.handled_at))
    .orderBy(asc(intents.created_at));
}

const startupReconcile = () => reconcile({ tick, cleanup: () => ops.cleanup(), launch: launchAndAnnounce });

/**
 * The checks that need no event, every tickSeconds. Claiming is here too because a slot frees up
 * without any webhook, and the PR check catches a conflict GitHub settled after a push's recheck.
 */
async function tick() {
  // Each check on its own: one failing (a source or GitHub down) must not skip the others this tick.
  return {
    // First, so stage reports a hook or MCP call could not deliver reach the board before anything reads it.
    outbox: await isolated(flushLocalOutbox),
    queued: await isolated(ops.queuedJobs),
    // An answer can land before its question reached the source, and its intent then finds nothing.
    resumed: await isolated(ops.resumeAnswered),
    stopsDelivered: await isolated(() => ops.deliverStops()),
    pullRequests: await isolated(ops.checkPullRequests),
    githubSnapshots: await isolated(refreshGithubSnapshots),
    // Before the merge decisions, so a run that just opened its PR is decided on its latest cost.
    reconciled: await isolated(ops.reconcileUsage),
    // After the PR check, so a merged or conflicting PR has already left pr.
    mergeDecisions: await isolated(() => decideMerges()),
    mainWatched: await isolated(() => watchMerges()),
    // Harnesses without hooks report no stage or PR; read them from GitHub and the thread instead.
    untracked: await isolated(() => inferUntracked()),
    watched: await isolated(ops.watchdog),
    stopsConfirmed: await isolated(() => confirmStops()),
    pairingsExpired: await isolated(expirePairings),
    synced: await isolated(writeBackPass),
  };
}

const beat = createBeat({
  machine,
  heartbeatCollectors: systemCollectors(async () => ({
    max: ops.config.factory.maxInFlight,
    inFlight: await ops.machineInFlight(machine.id),
  })),
  inventoryCollectors: inventoryCollectors(),
  inventoryMs: ops.config.factory.inventoryMinutes * 60_000,
  log,
});

// The startup beat marks this machine online at once; the slower inventory waits until the reconcile is done.
if (process.argv.includes("--once")) {
  await beat({ inventory: false });
  await serial("registry", ops.registerCheckouts);
  await serial("reconcile", startupReconcile);
  takeIntents(await openIntents());
  stopping = true;
  for (const timer of recheckTimers) clearTimeout(timer);
  await queue.drain();
  await verificationsSettled();
  await beat();
  await reportServer.stop();
  await releaseOwnership();
  await db.$client.end();
  process.exit(0);
}

log("start", { pid: process.pid, tickSeconds: ops.config.factory.tickSeconds, machine });
const wiring = wireHarnessReporting(join(import.meta.dirname, "../../../packages/reporting/src"));
log("harness-wiring", wiring);
const background = new Set<Promise<unknown>>();
function track(work: Promise<unknown>) {
  background.add(work);
  void work.then(() => background.delete(work), error => {
    background.delete(work);
    log("background:error", { error: String(error) });
  });
}
await beat({ inventory: false });
const heartbeatTimer = setInterval(() => { if (!stopping) track(beat()); }, ops.config.factory.tickSeconds * 1000);
// Before the first claim, so a fresh install has its checkouts registered and a default repo.
await serial("registry", ops.registerCheckouts);
await serial("reconcile", startupReconcile);
track(beat());
takeIntents(await openIntents());


const hourlyCleanup = everyAtMost(3_600_000, () => ops.cleanup());
const tickTimer = setInterval(() => {
  if (stopping) return;
  void serial("tick", async () => {
    const result = { ...(await tick()), ...(await launchAndAnnounce()) };
    const cleaned = await hourlyCleanup();
    return { ...result, ...(cleaned !== undefined && { cleaned }) };
  });
  // Durable intents remain authoritative between polling passes.
  track(openIntents().then(takeIntents));
}, ops.config.factory.tickSeconds * 1000);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeatTimer);
    clearInterval(tickTimer);
    for (const timer of recheckTimers) clearTimeout(timer);
    log("stop", { signal });
    void (async () => {
      await Promise.allSettled([...background]);
      await queue.drain();
      await verificationsSettled();
      await reportServer.stop();
      await releaseOwnership();
      await db.$client.end();
      process.exit(0);
    })().catch(error => {
      log("stop:error", { error: String(error) });
      process.exit(1);
    });
  });
}
