import type { JobRow } from "@factory/storage/schema";
import { planCleanup, type BranchState } from "./cleanup";
import { attemptBranch, parseBranch } from "./factory";
import type { RepoName } from "@factory/integrations/github/gh";
import { github } from "@factory/integrations/github/pulls";
import { localHost, type JobHost } from "./host";

type ClaimedJob = Pick<JobRow, "key" | "attempt" | "stage" | "stage_at" | "claimed_at">;

const sh = async (host: JobHost, cmd: string, args: string[], cwd?: string) =>
  (await host.run(cmd, args, { cwd, timeoutMs: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();


/** Linked worktrees by branch. The main checkout is listed first and never counts, whatever it has checked out. */
export async function linkedWorktrees(repo: string, host: JobHost = localHost) {
  const out = await sh(host, "git", ["worktree", "list", "--porcelain"], repo);
  const byBranch = new Map<string, string>();
  let path = "";
  let main = true;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (path) main = false;
      path = line.slice(9);
    }
    if (!main && line.startsWith("branch refs/heads/")) byBranch.set(line.slice(18), path);
  }
  return byBranch;
}

const GITHUB_REMOTE = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/;

export async function checkoutRepo(checkout: string, host: JobHost = localHost): Promise<RepoName> {
  const repo = GITHUB_REMOTE.exec(await sh(host, "git", ["remote", "get-url", "origin"], checkout))?.[1];
  if (!repo) throw new Error(`${checkout} has no GitHub origin`);
  return repo as RepoName;
}

async function outcomeOf(repo: RepoName, branch: string, job: ClaimedJob | undefined, head: string | null) {
  const prs = await github.pullsForHead(repo, branch);
  const merged = prs.find((p) => p.state === "merged");
  const mergedAtHead = Boolean(merged && head && merged.headSha === head);
  // A claimed job's own stage decides; a merged PR on its branch does not end a run that is still going.
  // An earlier attempt's branch is finished once the job was claimed again.
  if (job && branch !== attemptBranch(job.key, job.attempt)) {
    return { outcome: "failed" as const, outcomeAt: job.claimed_at, mergedAtHead };
  }
  if (job) {
    const outcome = job.stage === "done" ? "merged" : job.stage === "failed" ? "failed" : "open";
    return { outcome: outcome as "merged" | "failed" | "open", outcomeAt: job.stage_at, mergedAtHead };
  }
  if (merged) return { outcome: "merged" as const, outcomeAt: merged.mergedAt, mergedAtHead };
  const closed = prs.find((p) => p.state === "closed");
  if (closed) return { outcome: "failed" as const, outcomeAt: closed.closedAt, mergedAtHead };
  return { outcome: prs.length ? ("open" as const) : ("unknown" as const), outcomeAt: null, mergedAtHead };
}

async function countLines(host: JobHost, cmd: string, args: string[], cwd: string) {
  const out = await sh(host, cmd, args, cwd);
  return out ? out.split("\n").length : 0;
}

async function sizeKb(host: JobHost, path: string) {
  return Number((await sh(host, "du", ["-sk", path])).split(/\s/)[0]) || 0;
}

export type CleanupReport = {
  removed: { key: string; worktree: string | null; freedKb: number; salvagedTo?: string }[];
  held: { key: string; reason: string }[];
};

/** Removes finished factory worktrees and branches after execution ownership is observed. */
export async function cleanupRepo(
  repo: string,
  jobsByKey: Map<string, ClaimedJob>,
  graceDays: number,
  { now = new Date(), dryRun = false, host = localHost, directBranches = new Map<string, boolean>() } = {},
): Promise<CleanupReport> {
  const report: CleanupReport = { removed: [], held: [] };
  const [remote, trees, branchList, remoteList] = await Promise.all([
    checkoutRepo(repo, host),
    linkedWorktrees(repo, host),
    sh(host, "git", ["branch", "--list", "factory/*", "--format=%(refname:short)"], repo),
    sh(host, "git", ["ls-remote", "--heads", "origin", "refs/heads/factory/*"], repo),
  ]);
  const localBranches = new Set(branchList ? branchList.split("\n") : []);
  const remoteBranches = new Map(remoteList.split("\n").filter(Boolean).map(line => {
    const [sha, ref] = line.split(/\s+/);
    return [ref.replace("refs/heads/", ""), sha] as const;
  }));
  const branches = new Set([...localBranches, ...remoteBranches.keys(), ...trees.keys()]);

  const checkedOut = await sh(host, "git", ["branch", "--show-current"], repo);
  for (const branch of branches) {
    const key = parseBranch(branch)?.key;
    if (!key) continue;
    // One branch failing (GitHub, git) holds just that branch; the rest of the repo is still cleaned.
    try {
      if (branch === checkedOut) {
        report.held.push({ key, reason: "checked out in the main repo" });
        continue;
      }
      // Unknown execution ownership must hold the branch, including an empty inventory.
      if (!directBranches.has(branch)) {
        report.held.push({ key, reason: "execution ownership was not observed for this branch" });
        continue;
      }
      const worktreePath = trees.get(branch) ?? null;
      const local = localBranches.has(branch);
      const head = local ? await sh(host, "git", ["rev-parse", branch], repo) : remoteBranches.get(branch) ?? null;
      const state: BranchState = {
        key,
        branch,
        worktreePath,
        localBranch: local,
        ...(await outcomeOf(remote, branch, jobsByKey.get(key), head)),
        dirtyFiles: worktreePath && (await host.exists(worktreePath)) ? await countLines(host, "git", ["status", "--porcelain"], worktreePath) : 0,
        unpushedCommits: local ? await countLines(host, "git", ["rev-list", branch, "--not", "--remotes"], repo) : 0,
        threadRunning: directBranches.get(branch)!,
      };
      const plan = planCleanup(state, now, graceDays);
      const remoteHead = remoteBranches.get(branch);
      const removeRemote = Boolean(remoteHead && state.outcome === "merged" && state.mergedAtHead && remoteHead === head && !state.threadRunning && state.dirtyFiles === 0);
      if (removeRemote && !dryRun) {
        await sh(host, "git", ["push", `--force-with-lease=refs/heads/${branch}:${remoteHead}`, "origin", `:refs/heads/${branch}`], repo);
      }
      if (removeRemote && plan.kind === "skip" && plan.reason === "already clean") report.removed.push({ key, worktree: null, freedKb: 0 });
      if (plan.kind === "hold") report.held.push({ key, reason: plan.reason });
      if (plan.kind === "remove" && dryRun) {
        report.removed.push({ key, worktree: worktreePath, freedKb: worktreePath && (await host.exists(worktreePath)) ? await sizeKb(host, worktreePath) : 0 });
      } else if (plan.kind === "remove") {
        let freedKb = 0;
        if (worktreePath) {
          if (await host.exists(worktreePath)) freedKb = await sizeKb(host, worktreePath);
          try {
            await sh(host, "git", ["worktree", "remove", "--force", worktreePath], repo);
          } catch (error) {
            report.held.push({ key, reason: `git worktree remove failed: ${(error as Error).message.split("\n")[0]}` });
            continue;
          }
          // Git let go of it; ignored build output can still keep the directory alive.
          if (await host.exists(worktreePath)) await host.remove(worktreePath);
          await sh(host, "git", ["worktree", "prune"], repo);
        }
        if (local) {
          try {
            await sh(host, "git", ["branch", "-D", branch], repo);
          } catch (error) {
            report.held.push({ key, reason: `git branch -D failed: ${(error as Error).message.split("\n")[0]}` });
            continue;
          }
        }
        report.removed.push({ key, worktree: worktreePath, freedKb });
      }
    } catch (error) {
      report.held.push({ key, reason: `cleanup failed: ${(error as Error).message.split("\n")[0]}` });
    }
  }
  return report;
}

/** Remove only registered, unchanged review checkouts of finished jobs. */
export async function cleanupReviewerWorktrees(
  repo: string,
  jobs: readonly JobRow[],
  graceDays: number,
  isRunning: (threadId: string) => Promise<boolean>,
  { now = new Date(), dryRun = false, host = localHost } = {},
): Promise<CleanupReport> {
  const report: CleanupReport = { removed: [], held: [] };
  const linked = new Set((await allLinkedWorktrees(repo, host)).map(tree => tree.path.replaceAll("\\", "/")));
  for (const job of jobs) {
    if (job.stage !== "done" && job.stage !== "failed") continue;
    if (job.stage === "failed" && now.getTime() - (job.stage_at?.getTime() ?? now.getTime()) < graceDays * 86_400_000) continue;
    for (const round of [...job.review_history, ...(job.attempt_review ? [job.attempt_review] : [])].flatMap(review => review.rounds)) {
      if (!round.checkout || !linked.has(round.checkout.replaceAll("\\", "/"))) continue;
      try {
        if (!round.threadId || await isRunning(round.threadId)) {
          report.held.push({ key: job.key, reason: "reviewer is running or ownership is unavailable" });
          continue;
        }
        const dirty = await sh(host, "git", ["status", "--porcelain"], round.checkout);
        const head = await sh(host, "git", ["rev-parse", "HEAD"], round.checkout);
        if (dirty || head !== round.sha) {
          report.held.push({ key: job.key, reason: "reviewer checkout has changes or a different HEAD" });
          continue;
        }
        if (!dryRun) await sh(host, "git", ["worktree", "remove", "--force", round.checkout], repo);
        report.removed.push({ key: job.key, worktree: round.checkout, freedKb: 0 });
      } catch (error) {
        report.held.push({ key: job.key, reason: `reviewer cleanup failed: ${(error as Error).message.split("\n")[0]}` });
      }
    }
  }
  return report;
}

/** Every linked worktree with its branch, the main checkout excluded. */
async function allLinkedWorktrees(repo: string, host: JobHost) {
  const out = await sh(host, "git", ["worktree", "list", "--porcelain"], repo);
  const trees: { path: string; branch: string | null }[] = [];
  for (const block of out.split("\n\n").slice(1)) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (path) trees.push({ path, branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null });
  }
  return trees;
}

