import { asc, desc } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { agents, jobs, machines, repoSettings, runs } from "@factory/storage/schema";
import type { AgentRow, JobRow, MachineRow, RepoSettingsRow, RunRow } from "@factory/storage/schema";
import { branchCosts, type BranchCost } from "./spend";
import { attemptBranch } from "./factory";
import { inboxKind } from "./inbox";

export interface RealtimeSnapshot {
  version: 1;
  jobs: (JobRow & { needs_human: boolean })[];
  runs: Omit<RunRow, "cwd" | "transcript_path">[];
  agents: AgentRow[];
  machines: MachineRow[];
  spend: Record<string, BranchCost>;
  repositories: Pick<RepoSettingsRow, "repo" | "display_name" | "enabled" | "is_default">[];
}

/** One repeatable-read snapshot shared by desktop and browser. No transcript bodies or credentials. */
export async function realtimeSnapshot(): Promise<RealtimeSnapshot> {
  return db.transaction(async tx => {
    const jobRows = await tx.select().from(jobs).orderBy(desc(jobs.claimed_at), asc(jobs.id)).limit(200);
    const runRows = await tx.select({
      session_id: runs.session_id, repo: runs.repo, branch: runs.branch, job_key: runs.job_key,
      t3_thread_id: runs.t3_thread_id, role: runs.role, title: runs.title, status: runs.status,
      stage: runs.stage, stage_at: runs.stage_at, stage_summary: runs.stage_summary,
      question: runs.question, pr_url: runs.pr_url, started_at: runs.started_at,
      last_event_at: runs.last_event_at, model: runs.model,
      input_tokens: runs.input_tokens, output_tokens: runs.output_tokens,
      cache_read_tokens: runs.cache_read_tokens, cache_write_tokens: runs.cache_write_tokens,
    }).from(runs).orderBy(desc(runs.last_event_at), asc(runs.session_id)).limit(200);
    const agentRows = await tx.select().from(agents).orderBy(desc(agents.started_at), asc(agents.tool_use_id)).limit(1000);
    const machineRows = await tx.select().from(machines).orderBy(asc(machines.name), asc(machines.id));
    const repositories = await tx.select({ repo: repoSettings.repo, display_name: repoSettings.display_name, enabled: repoSettings.enabled, is_default: repoSettings.is_default }).from(repoSettings).orderBy(asc(repoSettings.repo));
    const spend = await branchCosts(tx, jobRows.map(job => attemptBranch(job.key, job.attempt)));
    return { version: 1 as const, jobs: jobRows.map(job => ({ ...job, needs_human: inboxKind(job) !== null })), runs: runRows, agents: agentRows, machines: machineRows, repositories, spend };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
