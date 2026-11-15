import { z } from "zod";
import type { MergeAssessment } from "./assessment";
import { headEvidenceSchema, notVerifiedWhy, shortSha, type HeadEvidence } from "./evidence";
import { uiFiles } from "./screenshots";
import { reviewAllowsPublication, type AttemptReview } from "./review";

// Whether a factory PR would merge on its own. The agent recommends merge unless it isn't confident
// (lib/assessment.ts); the runner enforces factual hard limits that no recommendation overrides. Pure, so the runner pass and the
// regressions share it.

export const AUTONOMY_LEVELS = ["off", "trial", "auto"] as const;
export const autonomySchema = z.enum(AUTONOMY_LEVELS);
export type Autonomy = z.infer<typeof autonomySchema>;

export const AUTONOMY_LABELS: Record<Autonomy, string> = { off: "Off", trial: "Trial", auto: "Merge when confident" };

export const CHECKS_TIMEOUT_MS = 60 * 60_000;
/** How long a head with no check run and no status may wait for CI to start before it counts as having none. */
export const DEFAULT_NO_CI_GRACE_MS = 5 * 60_000;
export const REVIEW_LABEL = "review";

export type RepoPolicy = { autonomy: Autonomy };
export const DEFAULT_POLICY: RepoPolicy = { autonomy: "off" };

export const MERGE_OUTCOMES = ["merge", "handover", "pending"] as const;
export type MergeOutcome = (typeof MERGE_OUTCOMES)[number];

export const MERGE_METHODS = ["squash", "merge", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

/** Where a factory merge started: the timer's own decision, or the owner's approval in the inbox or in run detail. */
export const MERGE_VIAS = ["auto", "inbox", "run_detail"] as const;
export type MergeVia = (typeof MERGE_VIAS)[number];

export const WATCH_STATES = ["watching", "green", "expired", "reverted", "revert_failed"] as const;
export type WatchState = (typeof WATCH_STATES)[number];

/** What the factory merged; the post-merge watch reads the base branch at this commit. */
export const factoryMergeSchema = z.object({
  sha: z.string(),
  method: z.enum(MERGE_METHODS),
  at: z.string(),
  base: z.string(),
  title: z.string(),
  /** The PR's commit count; a rebase merge put that many commits on the base. */
  commits: z.number().int().positive(),
  /** Absent on merges recorded before the entry point was kept. */
  via: z.enum(MERGE_VIAS).optional(),
});
export type FactoryMerge = z.infer<typeof factoryMergeSchema>;

export const watchSchema = z.object({
  state: z.enum(WATCH_STATES),
  until: z.string(),
  /** The checks that failed on the base branch. */
  failed: z.array(z.string()),
  revertPr: z.string().nullable(),
  /** Why the revert failed. */
  reason: z.string().nullable(),
});
export type MergeWatch = z.infer<typeof watchSchema>;

/** The most changed files a review summary lists; fileCount still counts them all. */
export const REVIEW_FILE_LIMIT = 100;

/** The PR's changed files at one head. */
export const reviewSchema = z.object({
  headSha: z.string(),
  files: z.array(z.object({ path: z.string(), additions: z.number(), deletions: z.number() })),
  fileCount: z.number().int(),
});
export type ReviewSummary = z.infer<typeof reviewSchema>;

export const verificationSchema = z.object({
  sha: z.string(),
  at: z.string(),
  state: z.enum(["running", "failed"]),
  reason: z.string().optional(),
});
export type RunnerVerificationRecord = z.infer<typeof verificationSchema>;

/**
 * Whether the runner can settle an unproven head by running the checks itself: it may start, it is
 * running them, it tried and couldn't, or it can't for this job at all.
 */
export type RunnerVerification = { kind: "available" } | { kind: "running" } | { kind: "failed"; reason: string } | { kind: "unavailable"; reason: string };

export const mergeDecisionSchema = z.object({
  outcome: z.enum(MERGE_OUTCOMES),
  reasons: z.array(z.string()),
  autonomy: autonomySchema,
  evaluatedAt: z.string(),
  /** The PR head the decision is about; null when autonomy is off and GitHub was not asked. */
  headSha: z.string().nullable(),
  /** When this head was first seen, so the checks timeout runs from the push, not the latest pass. */
  headSeenAt: z.string().nullable(),
  /** The stage event the decision read the assessment from. */
  stageEventId: z.string().nullable(),
  /** Why GitHub refused the factory's merge of this head; it is not tried again until the head moves. */
  blocked: z.string().optional(),
  /** Written right before the factory asks GitHub to merge, so a crash after the merge is recorded on a later pass. */
  merging: z.object({ headSha: z.string(), method: z.enum(MERGE_METHODS), at: z.string(), via: z.enum(MERGE_VIAS).optional() }).optional(),
  merged: factoryMergeSchema.optional(),
  watch: watchSchema.optional(),
  /** Fingerprints of the decision comments last posted on the PR and in the source. */
  comments: z.object({ pr: z.string().optional(), source: z.string().optional() }).optional(),
  /** The facts the decision read, for the inbox; absent when autonomy is off, which reads none. */
  review: reviewSchema.optional(),
  /** Set when the owner approved this head in the inbox or run detail; the merge then skips the agent's and the policy's reasons. */
  approvedBy: z.string().optional(),
  /** What the evidence proved about headSha when the decision read it; absent when autonomy is off or before evidence existed. */
  evidence: headEvidenceSchema.optional(),
  /** The runner's own run of the checks at headSha in the job's sandbox; at most one per head. */
  verification: verificationSchema.optional(),
});
export type MergeDecision = z.infer<typeof mergeDecisionSchema>;

/** `none`: no check run or status reported on the head past the grace period, and the base branch requires none. */
export type CheckState = "success" | "pending" | "failure" | "none";
export type ChangedFile = { path: string; additions: number; deletions: number };

/** What GitHub says about the PR head. */
export type PrFacts = {
  headSha: string;
  mergeable: "mergeable" | "conflicting" | "unknown";
  /** Non-Bugbot CI checks and commit statuses at the head. */
  checks: CheckState;
  files: readonly ChangedFile[];
};

export type DecisionInput = {
  policy: RepoPolicy;
  assessment: MergeAssessment | null;
  /** Review-enabled attempts use the independent verdict instead of builder self-assessment. */
  independentReview?: { review: AttemptReview; attempt: number };
  labels: readonly string[];
  /** Null only when autonomy is off, which never asks GitHub. */
  pr: PrFacts | null;
  headSeenAt: number;
  now: number;
  checksTimeoutMs?: number;
  /** What the evidence for this attempt proves about the PR head; see lib/evidence.ts. */
  evidence: HeadEvidence;
  runner: RunnerVerification;
  /** Why the PR edits what its checks depend on (lib/trusted-checks.ts). Any makes it a handover whatever the evidence says. */
  trustEdits: readonly string[];
  /** Whether the agent had the sandbox's headless browser, so a change to a page can come with screenshots. */
  browser: boolean;
};

/** `verify` is set when only verification at the head stands between the PR and a merge, and the runner may run it. */
export type Decision = { outcome: MergeOutcome; reasons: string[]; verify?: true };

const minutes = (ms: number) => Math.round(ms / 60_000);

/** Hard limits only; each failure is one plain reason. */
function hardLimits(input: DecisionInput, pr: PrFacts) {
  const reasons: string[] = [];
  if (input.labels.some((l) => l.toLowerCase() === REVIEW_LABEL)) reasons.push(`The issue has the "${REVIEW_LABEL}" label.`);
  if (pr.checks === "failure") reasons.push("A check failed on the latest commit.");
  if (pr.mergeable === "conflicting") reasons.push("The pull request conflicts with its base branch.");
  return reasons;
}

function agentReasons({ assessment, independentReview, pr }: DecisionInput) {
  if (independentReview?.review.policy.enabled) {
    return pr && reviewAllowsPublication(independentReview.review, independentReview.attempt, pr.headSha)
      ? [] : ["Independent review PASS is required for this attempt and PR head."];
  }
  if (!assessment) return ["The agent didn't report an assessment."];
  if (assessment.recommendation === "merge") return [];
  return [`The agent isn't confident: ${assessment.confidence.reason ?? "it recommends handing over."}`];
}

/** A change to a page needs screenshots of it, when the agent had a browser to take them with. */
function screenshotReasons({ assessment, browser }: DecisionInput, pr: PrFacts): string[] {
  if (!browser || !assessment || assessment.screenshots?.length) return [];
  const ui = uiFiles(pr.files.map((f) => f.path));
  if (ui.length === 0) return [];
  const named = ui.slice(0, 3).join(", ") + (ui.length > 3 ? ` and ${ui.length - 3} more` : "");
  return [`The pull request changes UI files (${named}), but the agent attached no screenshots.`];
}

/** The verified-at-head limit: what the agent or the runner ran at exactly the PR's head. */
function evidenceReasons({ evidence, runner }: DecisionInput, pr: PrFacts): string[] {
  const head = shortSha(pr.headSha);
  switch (evidence.state) {
    case "verified":
      return [];
    case "no_checks":
      return ["No checks defined for this repo."];
    case "failed":
      return [`Checks failed at ${head}: ${evidence.failed.join(", ")}.`];
    case "missing":
    case "stale":
    case "dirty":
    case "incomplete":
    case "untrusted":
      switch (runner.kind) {
        case "available":
        case "running":
          return [];
        case "failed":
          return [`Not verified at ${head}: ${notVerifiedWhy(evidence)}, and the factory couldn't run the checks itself: ${runner.reason}.`];
        case "unavailable":
          return [`Not verified at ${head}: ${notVerifiedWhy(evidence)}; ${runner.reason}.`];
        default: {
          const never: never = runner;
          throw new Error(`unknown runner verification ${String(never)}`);
        }
      }
    default: {
      const never: never = evidence;
      throw new Error(`unknown evidence state ${String(never)}`);
    }
  }
}

const verificationWait = (pr: PrFacts) => `verification at ${shortSha(pr.headSha)}`;

function waitingOn(input: DecisionInput, pr: PrFacts) {
  const waiting: string[] = [];
  if (pr.checks === "pending") waiting.push("checks");
  if (pr.mergeable === "unknown") waiting.push("GitHub's mergeability check");
  if (evidenceReasons(input, pr).length === 0 && input.evidence.state !== "verified") waiting.push(verificationWait(pr));
  return waiting;
}

/** Off evaluates nothing: the PR is ready for review, with no reasons to give. */
export const OFF_DECISION: Decision = { outcome: "handover", reasons: [] };

export function decideMerge(input: DecisionInput): Decision {
  if (input.policy.autonomy === "off") return OFF_DECISION;
  if (!input.pr) throw new Error("decideMerge needs the PR's facts unless autonomy is off");
  const reasons = [...agentReasons(input), ...hardLimits(input, input.pr), ...screenshotReasons(input, input.pr), ...input.trustEdits, ...evidenceReasons(input, input.pr)];
  if (reasons.length > 0) return { outcome: "handover", reasons };
  const waiting = waitingOn(input, input.pr);
  if (waiting.length > 0) {
    const timeout = input.checksTimeoutMs ?? CHECKS_TIMEOUT_MS;
    if (input.now - input.headSeenAt < timeout) {
      const onlyVerification = waiting.length === 1 && waiting[0] === verificationWait(input.pr) && input.runner.kind === "available";
      return { outcome: "pending", reasons: [`Waiting for ${waiting.join(", ")}.`], ...(onlyVerification && { verify: true as const }) };
    }
    return { outcome: "handover", reasons: [`${waiting.join(", ")} didn't finish within ${minutes(timeout)} minutes.`.replace(/^./, (c) => c.toUpperCase())] };
  }
  return { outcome: "merge", reasons: input.pr.checks === "none" ? [noCiReason(input.pr.headSha)] : [] };
}

/** Said on a merge where the factory's evidence at the head stood in for CI. */
export const noCiReason = (headSha: string) => `No CI on this repo; relying on the factory's own checks at ${shortSha(headSha)}.`;

export function reviewSummary(pr: Pick<PrFacts, "headSha" | "files">): ReviewSummary {
  return {
    headSha: pr.headSha,
    files: pr.files.slice(0, REVIEW_FILE_LIMIT).map(({ path, additions, deletions }) => ({ path, additions, deletions })),
    fileCount: pr.files.length,
  };
}

/**
 * What still stops a merge the owner approved. Only facts about the PR count: the agent's
 * reasons and the policy's limits are the owner's to overrule.
 */
export function approvalBlockers(pr: Pick<PrFacts, "checks" | "mergeable">): string[] {
  const reasons: string[] = [];
  if (pr.checks === "failure") reasons.push("A check failed on the latest commit.");
  if (pr.checks === "pending") reasons.push("Checks are still running on the latest commit.");
  if (pr.mergeable === "conflicting") reasons.push("The pull request conflicts with its base branch.");
  if (pr.mergeable === "unknown") reasons.push("GitHub is still checking whether the pull request merges cleanly.");
  return reasons;
}

/** The reason a decision hands over when GitHub refuses the factory's merge. */
export const blockedReason = (detail: string) => `The factory's GitHub App can't merge in this repo: ${detail}`;
