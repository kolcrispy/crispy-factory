import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { jobs } from "@factory/storage/schema";
import { attemptBranch } from "@factory/core/factory";
import type { RepoName } from "@factory/integrations/github/gh";
import { github } from "@factory/integrations/github/pulls";
import { hosts } from "@factory/core/host";
import { parseJobs } from "@factory/core/sources/index";
import type { Job } from "@factory/core/sources/types";
import { runnerEventId } from "@factory/core/stages";
import { bindingOf } from "./binding";
import { thisMachine } from "./heartbeat";
import { config, IN_FLIGHT, postEvent, threads } from "./ops";
import { repoSettings } from "@factory/storage/schema";

// Session settlement never implies completion. Publication requires explicit verified handoff.

type Settled = "completed" | "interrupted" | "failed";

/** OMP's run statuses for a thread with no active run. */
const settledAs = (status: string | null): Settled =>
  status === "failed" ? "failed" : status === "interrupted" || status === "cancelled" || status === "rolled_back" ? "interrupted" : "completed";


const sessionOf = (job: Job) => job.session_id ?? runnerEventId("inferred", job.external_id, job.attempt);

async function inferJob(job: Job, now: number): Promise<string | undefined> {
  const current = async () => {
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    return row && !row.stop && !row.attention && row.attempt === job.attempt && row.execution_id === job.execution_id && row.builder_handoff?.eventId === job.builder_handoff?.eventId && row.stage === job.stage;
  };
  if (!(await current())) return;
  if (job.attention) return;
  const thread = await threads.read(job.execution_id, hosts.forJob(job));
  if (thread.state === "running") return;
  const handoff = job.builder_handoff;
  if (thread.state !== "stopped" || settledAs(thread.status) !== "completed" || !handoff) {
    if (now - job.updated_at.getTime() < config.factory.stoppedGraceMinutes * 60_000) return;
    await db.update(jobs).set({ attention: { eventId: `settled:${job.attempt}:${now}`, at: now,
      reason: "Builder stopped without a verified handoff.", action: "Inspect the existing session and resume the builder to produce an explicit handoff." },
      updated_at: new Date(now) }).where(and(eq(jobs.id, job.id), eq(jobs.attempt, job.attempt)));
    return "needs_human";
  }
  const host = hosts.forJob(job);
  const [repository] = await db.select().from(repoSettings).where(eq(repoSettings.repo, job.repo));
  if (!repository?.checkout_path || !repository.default_branch) throw new Error("Publication repository unavailable.");
  const root = repository.checkout_path;
  const branch = attemptBranch(job.key, job.attempt);
  const git = async (args: string[]) => (await host.run("git", ["-C", root, ...args], { timeoutMs: 120_000 })).stdout.trim();
  if (handoff.attempt !== job.attempt || await git(["rev-parse", branch]) !== handoff.sha) throw new Error("Handoff revision changed before publication.");
  if (thread.checkout && (await host.run("git", ["-C", thread.checkout, "status", "--porcelain"])).stdout.trim()) throw new Error("Builder checkout is dirty after handoff.");
  if (!job.evidence || job.evidence.sha !== handoff.sha || !job.evidence.clean || job.evidence.attempt !== job.attempt || job.evidence.checks.some(check => !check.passed || check.exitCode !== 0)) throw new Error("Handoff evidence is no longer valid.");
  if (!(await current())) return;
  await git(["push", "origin", `${handoff.sha}:refs/heads/${branch}`]);
  if ((await git(["ls-remote", "origin", `refs/heads/${branch}`])).split(/\s+/)[0] !== handoff.sha) throw new Error("Remote head differs from handoff.");
  if (!(await current())) return;
  const pull = await github.createPull(job.repo as RepoName, { title: job.title, head: branch, base: repository.default_branch,
    body: [job.description ?? "", typeof job.source_state.issueUrl === "string" ? `Closes ${job.source_state.issueUrl}` : "", handoff.summary, `Verified revision: ${handoff.sha}`, `Job: ${job.key}`].filter(Boolean).join("\n\n") });
  if (!(await current())) return;
  await postEvent({ eventId: runnerEventId("inferred", "handoff", job.key, job.attempt, handoff.eventId), sessionId: sessionOf(job),
    at: Date.now(), kind: "stage", stage: "ready", jobKey: job.key, branch, summary: handoff.summary, prUrl: pull.url });
  return "ready";
}

/**
 * The timer's pass over this machine's working jobs on untracked harnesses. A hibernated job is
 * never woken for it. Each job on its own, so one GitHub or OMP failure does not hold back the rest.
 */
export async function inferUntracked({ now = Date.now(), only }: { now?: number; only?: string[] } = {}) {
  const machine = await thisMachine();
  const rows = parseJobs(
    await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.machine_id, machine.id), inArray(jobs.stage, IN_FLIGHT), isNotNull(jobs.execution_id), only ? inArray(jobs.key, only) : undefined)),
  );
  // All review-disabled harnesses use the same explicit handoff contract.
  const done: string[] = [];
  const errors: { key: string; error: string }[] = [];
  for (const job of rows) {
    if (job.stop || job.attention) continue;
    if (job.attempt_review?.policy.enabled) continue;
    if (bindingOf(job.execution_id) !== "bound") continue;
    try {
      const outcome = await inferJob(job, now);
      if (outcome) done.push(`${job.key}:${outcome}`);
    } catch (error) {
      errors.push({ key: job.key, error: error instanceof Error ? error.message : String(error) });
      await db.update(jobs).set({ attention: { eventId: `publication:${job.attempt}:${now}`, at: now, reason: error instanceof Error ? error.message : String(error), action: "Inspect the builder revision and retry publication after resolving the error." }, updated_at: new Date(now) }).where(and(eq(jobs.id, job.id), eq(jobs.attempt, job.attempt)));
    }
  }
  return errors.length > 0 ? { done, errors } : done;
}
