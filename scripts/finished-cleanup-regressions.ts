import "./test-guard";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupRepo, cleanupReviewerWorktrees } from "@factory/core/worktrees";
import { localHost } from "@factory/core/host";
import { github } from "@factory/integrations/github/pulls";
import { internalJob } from "./fixtures";

const root = mkdtempSync(join(tmpdir(), "factory-finished-cleanup-"));
const repo = join(root, "repo");
const remote = join(root, "remote.git");
const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args], { encoding: "utf8", stdio: "pipe" }).trim();
const originalPulls = github.pullsForHead;
try {
  execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  git("commit", "--allow-empty", "-m", "base");
  git("remote", "add", "origin", remote);
  const sha = git("rev-parse", "HEAD");
  git("branch", "factory/JOB-9002");
  git("push", "origin", "factory/JOB-9002");
  const host = { ...localHost, run: async (command: string, args: string[], options?: Parameters<typeof localHost.run>[2]) => {
    if (command === "git" && args.join(" ") === "remote get-url origin") return { stdout: "https://github.com/fixture/cleanup.git", stderr: "" };
    return localHost.run(command, args, options);
  } };
  github.pullsForHead = async () => [{ state: "merged", headSha: sha, mergedAt: new Date(), closedAt: null }];
  const options = { host, directBranches: new Map([["factory/JOB-9002", false]]) };
  await cleanupRepo(repo, new Map(), 3, { ...options, dryRun: true });
  assert.match(git("ls-remote", "--heads", "origin"), /factory\/JOB-9002/, "dry run preserves remote branch");
  await cleanupRepo(repo, new Map(), 3, options);
  assert.equal(git("ls-remote", "--heads", "origin"), "", "merged remote branch is deleted");
  assert.equal(git("branch", "--list", "factory/*"), "", "merged local branch is deleted");
  git("branch", "factory/JOB-9002");
  git("push", "origin", "factory/JOB-9002");
  github.pullsForHead = async () => [{ state: "merged", headSha: "a".repeat(40), mergedAt: new Date(), closedAt: null }];
  await cleanupRepo(repo, new Map(), 3, options);
  assert.match(git("ls-remote", "--heads", "origin"), /factory\/JOB-9002/, "different merged SHA never authorizes remote deletion");

  const checkout = join(root, "review");
  git("worktree", "add", "--detach", checkout, sha);
  const job = internalJob("finished-cleanup", "JOB-9002", { stage: "done", attempt: 1, review_history: [], attempt_review: { attempt: 1, policy: { enabled: true, provider: "omp", model: "fixture" }, state: "passed", builderThreadId: null, builderSessionId: null, automaticRepairs: 0, rounds: [{ round: 1, sha, base: sha, state: "complete", checkout, threadId: "omp:review:JOB-9002:1:1", sessionId: null, startedAt: 1 }] } });
  const jobs = [job as Parameters<typeof cleanupReviewerWorktrees>[1][number]];
  await cleanupReviewerWorktrees(repo, jobs, 3, async () => true, { host });
  assert.ok(existsSync(checkout), "live reviewer is preserved");
  await cleanupReviewerWorktrees(repo, jobs, 3, async () => { throw new Error("unknown lease"); }, { host });
  assert.ok(existsSync(checkout), "unknown ownership is preserved");
  writeFileSync(join(checkout, "uncommitted.txt"), "keep");
  await cleanupReviewerWorktrees(repo, jobs, 3, async () => false, { host });
  assert.ok(existsSync(checkout), "uncommitted reviewer work is preserved");
  rmSync(join(checkout, "uncommitted.txt"));
  await cleanupReviewerWorktrees(repo, jobs, 3, async () => false, { host, dryRun: true });
  assert.ok(existsSync(checkout), "dry run preserves review checkout");
  await cleanupReviewerWorktrees(repo, jobs, 3, async () => false, { host });
  assert.equal(existsSync(checkout), false, "finished clean reviewer checkout is removed");
  assert.ok(!git("worktree", "list", "--porcelain").includes(checkout.replaceAll("\\", "/")), "Git registration is removed too");
  console.log("Finished reviewer and leased remote branch cleanup regressions passed");
} finally {
  github.pullsForHead = originalPulls;
  rmSync(root, { recursive: true, force: true });
}
process.exit(0);
