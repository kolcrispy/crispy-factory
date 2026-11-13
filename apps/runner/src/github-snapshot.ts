import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { jobs } from "@factory/storage/schema";
import { github } from "@factory/integrations/github/pulls";
import type { RepoName } from "@factory/integrations/github/gh";
import { reviewSummary } from "@factory/core/merge-decision";
import { thisMachine } from "./heartbeat";

/** Remote dashboard projections are pinned to both PR and attempt before publication. */
export async function refreshGithubSnapshots() {
  const rows = await db.select().from(jobs).where(and(eq(jobs.machine_id, (await thisMachine()).id), eq(jobs.stage, "pr"), isNotNull(jobs.pr_url)));
  const refreshed: string[] = [];
  for (const job of rows) {
    const pull = await github.pullRequest(job.pr_url!);
    const detail = await github.pullDetail(job.pr_url!);
    const [files, checks, findings] = await Promise.all([
      github.pullFiles(job.pr_url!),
      github.checkState(job.repo as RepoName, detail.headSha, { baseRef: detail.baseRef }),
      github.bugbotFindings(job.pr_url!),
    ]);
    if (pull.headSha !== detail.headSha) continue;
    await db.update(jobs).set({ github_snapshot: {
      prUrl: job.pr_url!, attempt: job.attempt, observedAt: new Date().toISOString(),
      state: pull.state, title: pull.title, headSha: detail.headSha, mergeable: detail.mergeable,
      review: reviewSummary({ headSha: detail.headSha, files, bugbot: { review: checks.bugbot, findings } }),
    } }).where(and(eq(jobs.id, job.id), eq(jobs.attempt, job.attempt), eq(jobs.pr_url, job.pr_url!)));
    refreshed.push(job.key);
  }
  return refreshed;
}
