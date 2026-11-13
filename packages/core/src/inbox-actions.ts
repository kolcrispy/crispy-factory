import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "@factory/storage/schema";
import { auditLog, intents, jobs, type IntentKind, type JobRow } from "@factory/storage/schema";
import { isOwner, type SessionUser } from "./auth/owner";
import type { Mergeable } from "@factory/integrations/github/pulls";
import {
  allows,
  followUpIssue,
  inboxKind,
  MAX_FEEDBACK_CHARS,
  MAX_FOLLOW_UP_CHARS,
  MAX_RETRY_NOTE_CHARS,
  type ApproveDetail,
  type CloseDetail,
  type FeedbackDetail,
  type InboxAction,
  type RetryDetail,
} from "./inbox";
import { mergeDecisionSchema, type ReviewSummary } from "./merge-decision";
import { createJob, type NewJobDeps } from "./new-job";
import { parseJob } from "./sources/index";
import type { JobId } from "./sources/types";
import { githubSnapshotSchema } from "./github-snapshot";

// The inbox's owner-only actions, and run detail's Merge, which records the inbox's approval. Each one checks the owner and that the job still offers the
// action, then records an intent for the job's runner; only dismiss and the answer's comment act
// at once. A request id from the browser keys each intent, so a double submit records it once.
// The browser asks for the intent's outcome until the runner has handled it.

export type InboxDeps = {
  db: NodePgDatabase<typeof schema>;
  user: () => Promise<SessionUser | null | undefined>;
  /** Files a job the way the panel's New job does. */
  newJob: NewJobDeps;
  now?: () => Date;
};

/** An action done at once has no intent, and may say what it did. */
export type InboxOutcome = { ok: true; intentId: string | null; message?: string } | { ok: false; message: string };

const OWNER_ONLY = "Only the factory owner can act on the inbox.";
const requestIdSchema = z.uuid();

const NOT_OFFERED: Record<InboxAction, string> = {
  answer: "The job is no longer waiting on an answer.",
  approve: "The pull request is no longer waiting on your review.",
  request_changes: "The job is no longer waiting on your review.",
  follow_up: "Only a merge whose revert failed takes a follow-up.",
  close: "The job is no longer waiting on you.",
  dismiss: "Only a failed job or a stop that couldn't be confirmed can be dismissed.",
  retry_stop: "The stop is no longer waiting on you.",
  retry: "Only a failed job can be retried.",
};

async function ownerJob(deps: InboxDeps, jobId: JobId, action: InboxAction) {
  const user = await deps.user();
  if (!isOwner(user)) return { ok: false, message: OWNER_ONLY } as const;
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return { ok: false, message: `No job ${jobId}.` } as const;
  if (!allows(inboxKind(job), action)) return { ok: false, message: NOT_OFFERED[action] } as const;
  return { ok: true, actor: user!.email, job } as const;
}

async function replay(deps: InboxDeps, jobId: JobId, kind: IntentKind, requestId: string): Promise<InboxOutcome | null> {
  if (!isOwner(await deps.user())) return { ok: false, message: OWNER_ONLY };
  const id = `panel:${kind}:${requestId}`;
  const [existing] = await deps.db.select().from(intents).where(eq(intents.id, id));
  if (!existing) return null;
  return existing.job_id === jobId ? { ok: true, intentId: id } : { ok: false, message: "The request id already belongs to another job." };
}

async function record(deps: InboxDeps, job: JobRow, kind: IntentKind, requestId: string, detail: object): Promise<InboxOutcome> {
  const id = `panel:${kind}:${requestId}`;
  await deps.db
    .insert(intents)
    .values({ id, kind, job_id: job.id, pr_url: job.pr_url, detail: JSON.stringify(detail), created_at: (deps.now ?? (() => new Date()))() })
    .onConflictDoNothing();
  const existing = await replay(deps, job.id, kind, requestId);
  if (existing) return existing;
  return { ok: true, intentId: id };
}

const badRequest = (requestId: string) => !requestIdSchema.safeParse(requestId).success;

/** Accepts a stop durably even while the owning runner is offline. */
export async function requestStop(deps: InboxDeps, jobId: JobId, requestId: string, reason: string): Promise<InboxOutcome> {
  if (badRequest(requestId) || reason.length > 2000) return { ok: false, message: "The request is not valid." };
  const previous = await replay(deps, jobId, "stop", requestId);
  if (previous) return previous;
  const user = await deps.user();
  if (!isOwner(user)) return { ok: false, message: OWNER_ONLY };
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || job.stage === "merged" || job.stage === "failed") return { ok: false, message: "Only an active job can be stopped." };
  return record(deps, job, "stop", requestId, { actor: user!.email, attempt: job.attempt, reason: reason.trim() });
}

/** Asks the runner to merge the PR at the head the owner reviewed; null merges whatever head it has. */
export async function approveMerge(deps: InboxDeps, jobId: JobId, requestId: string, headSha: string | null): Promise<InboxOutcome> {
  if (badRequest(requestId)) return { ok: false, message: "The request is not valid." };
  const previous = await replay(deps, jobId, "approve_merge", requestId);
  if (previous) return previous;
  const found = await ownerJob(deps, jobId, "approve");
  if (!found.ok) return found;
  return record(deps, found.job, "approve_merge", requestId, { actor: found.actor, headSha, via: "inbox" } satisfies ApproveDetail);
}

/** Why run detail's Merge is not offered on this job, or null when it is. */
function notMergeable(job: JobRow): string | null {
  if (job.stage !== "pr" || !job.pr_url) return "The job is no longer waiting on a pull request.";
  const decision = mergeDecisionSchema.safeParse(job.merge_decision).data;
  if (decision?.merged) return "The factory already merged this pull request.";
  if (decision?.merging) return "The factory is already merging this pull request.";
  return null;
}

/**
 * Run detail's Merge: the same approve_merge intent as the inbox's Approve, for any job in pr the
 * factory is not already merging, pinned to the head the dialog showed. The runner's merge
 * service does the merge; this only records the request.
 */
export async function approveFromRunDetail(deps: InboxDeps, jobId: JobId, requestId: string, headSha: string): Promise<InboxOutcome> {
  if (badRequest(requestId) || !headSha) return { ok: false, message: "The request is not valid." };
  const previous = await replay(deps, jobId, "approve_merge", requestId);
  if (previous) return previous;
  const user = await deps.user();
  if (!isOwner(user)) return { ok: false, message: OWNER_ONLY };
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return { ok: false, message: `No job ${jobId}.` };
  const refused = notMergeable(job);
  if (refused) return { ok: false, message: refused };
  return record(deps, job, "approve_merge", requestId, { actor: user!.email, headSha, via: "run_detail" } satisfies ApproveDetail);
}

export type MergeTarget = { title: string; headSha: string; repo: string; mergeable: Mergeable };

/** Dashboard reads runner observations; the merge executor always revalidates the pinned head. */
export async function mergeTarget(deps: Pick<InboxDeps, "db" | "user">, jobId: JobId): Promise<MergeTarget | null> {
  if (!isOwner(await deps.user())) return null;
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || notMergeable(job)) return null;
  const pull = githubSnapshotSchema.safeParse(job.github_snapshot).data;
  if (!pull || pull.prUrl !== job.pr_url || pull.attempt !== job.attempt || pull.state !== "open") return null;
  return { title: pull.title, headSha: pull.headSha, repo: job.repo, mergeable: pull.mergeable };
}

const feedbackSchema = z.string().trim().min(1, "Write what should change.").max(MAX_FEEDBACK_CHARS, "The feedback is too long.");

/** Sends the owner's feedback to the job's thread, which goes back to work on the same PR. */
export async function requestChanges(deps: InboxDeps, jobId: JobId, requestId: string, body: string): Promise<InboxOutcome> {
  if (badRequest(requestId)) return { ok: false, message: "The request is not valid." };
  const text = feedbackSchema.safeParse(body);
  if (!text.success) return { ok: false, message: text.error.issues[0]!.message };
  const previous = await replay(deps, jobId, "request_changes", requestId);
  if (previous) return previous;
  const found = await ownerJob(deps, jobId, "request_changes");
  if (!found.ok) return found;
  const detail: FeedbackDetail = { from: "panel", id: `panel:${requestId}`, actor: found.actor, body: text.data };
  return record(deps, found.job, "request_changes", requestId, detail);
}

/** Leaves room in the issue's 10,000 characters for the facts the follow-up adds. */
const followUpSchema = z.string().trim().min(1, "Write what the follow-up should fix.").max(MAX_FOLLOW_UP_CHARS, "The follow-up is too long.");

/**
 * Files a new issue to fix main after a merge whose revert failed, with the original job's harness
 * then takes the item out of the inbox. The merged attempt's worktree is
 * gone, so its thread can't do the fix. The request id keys the issue, so a retry files it once.
 */
export async function fileFollowUp(deps: InboxDeps, jobId: JobId, requestId: string, body: string): Promise<InboxOutcome> {
  if (badRequest(requestId)) return { ok: false, message: "The request is not valid." };
  const text = followUpSchema.safeParse(body);
  if (!text.success) return { ok: false, message: text.error.issues[0]!.message };
  const found = await ownerJob(deps, jobId, "follow_up");
  if (!found.ok) return found;
  const { job } = found;
  const decision = mergeDecisionSchema.safeParse(job.merge_decision).data ?? null;
  const issue = followUpIssue(job, decision, text.data);
  const requested = parseJob(job).source_state.requestedProvider;
  // Disabled providers fall back to Settings rather than blocking the follow-up.
  const provider = requested && (await deps.newJob.harnesses())?.some(h => h.id === requested && h.enabled) ? requested : undefined;
  // The fix goes to main of the same repo; a repo disabled since then sends it to the default.
  const repo = (await deps.newJob.registry()).some((r) => r.repo === job.repo && r.enabled) ? job.repo : undefined;
  const filed = await createJob(deps.newJob, { ...issue, requestId, provider, repo });
  if (!filed.ok) return { ok: false, message: filed.message };
  const now = (deps.now ?? (() => new Date()))();
  await deps.db.update(jobs).set({ dismissed_at: now }).where(eq(jobs.id, job.id));
  await deps.db
    .insert(auditLog)
    .values({
      id: `follow-up:${requestId}`,
      at: now,
      actor: found.actor,
      action: "follow_up_filed",
      job_id: job.id,
      target: filed.url,
      head_sha: decision?.merged?.sha ?? "",
      result: "ok",
      detail: `Filed ${filed.identifier} to fix main after the revert of ${job.key} failed.`,
    })
    .onConflictDoNothing();
  return { ok: true, intentId: null, message: `Filed ${filed.identifier}. The factory picks it up as a new job.` };
}

/** Records the answer and question identity for runner delivery without any external source. */
export async function answerQuestion(deps: InboxDeps, jobId: JobId, requestId: string, body: string): Promise<InboxOutcome> {
  if (badRequest(requestId)) return { ok: false, message: "The request is not valid." };
  const text = feedbackSchema.safeParse(body);
  if (!text.success) return { ok: false, message: "Write an answer." };
  const previous = await replay(deps, jobId, "answer", requestId);
  if (previous) return previous;
  const found = await ownerJob(deps, jobId, "answer");
  if (!found.ok) return found;
  return record(deps, found.job, "answer", requestId, { actor: found.actor, body: text.data, attempt: found.job.attempt, questionEventId: found.job.stage_event_id });
}

/** Closes the job's PR and fails the job with the owner's reason. */
export async function closeJob(deps: InboxDeps, jobId: JobId, requestId: string, reason: string): Promise<InboxOutcome> {
  if (badRequest(requestId)) return { ok: false, message: "The request is not valid." };
  if (reason.length > 2000) return { ok: false, message: "The reason is too long." };
  const previous = await replay(deps, jobId, "close_job", requestId);
  if (previous) return previous;
  const found = await ownerJob(deps, jobId, "close");
  if (!found.ok) return found;
  return record(deps, found.job, "close_job", requestId, { actor: found.actor, reason: reason.trim() } satisfies CloseDetail);
}

/** Asks the job's runner to interrupt the stopped job's threads again and wait for them to settle. */
export async function retryStop(deps: InboxDeps, jobId: JobId, requestId: string): Promise<InboxOutcome> {
  if (badRequest(requestId)) return { ok: false, message: "The request is not valid." };
  const previous = await replay(deps, jobId, "retry_stop", requestId);
  if (previous) return previous;
  const found = await ownerJob(deps, jobId, "retry_stop");
  if (!found.ok) return found;
  return record(deps, found.job, "retry_stop", requestId, { actor: found.actor });
}

const retryNoteSchema = z.string().trim().max(MAX_RETRY_NOTE_CHARS, "The note is too long.");

/**
 * Asks the runner to start another attempt of a failed job, the way adding the factory label again
 * does, with an optional note for that attempt. The detail names the failed attempt, so a double
 * click or a replay starts one attempt.
 */
export async function retryFailed(deps: InboxDeps, jobId: JobId, requestId: string, note: string): Promise<InboxOutcome> {
  if (badRequest(requestId)) return { ok: false, message: "The request is not valid." };
  const text = retryNoteSchema.safeParse(note);
  if (!text.success) return { ok: false, message: text.error.issues[0]!.message };
  const previous = await replay(deps, jobId, "retry_job", requestId);
  if (previous) return previous;
  const found = await ownerJob(deps, jobId, "retry");
  if (!found.ok) return found;
  return record(deps, found.job, "retry_job", requestId, { actor: found.actor, attempt: found.job.attempt, note: text.data } satisfies RetryDetail);
}

/**
 * Hides a failed job, or an unconfirmed stop the owner checked in T3, from the inbox and changes
 * nothing else; a later failure shows again. Dismissing an unconfirmed stop also lets the label retry the job.
 */
export async function dismissJob(deps: InboxDeps, jobId: JobId): Promise<InboxOutcome> {
  const found = await ownerJob(deps, jobId, "dismiss");
  if (!found.ok) return found;
  await deps.db.update(jobs).set({ dismissed_at: (deps.now ?? (() => new Date()))() }).where(eq(jobs.id, found.job.id));
  return { ok: true, intentId: null };
}

export type IntentOutcome = { status: "pending" } | { status: "done"; message: string } | { status: "failed"; message: string };

const INBOX_INTENTS = ["approve_merge", "request_changes", "close_job", "answer", "retry_stop", "retry_job"] as const satisfies readonly IntentKind[];

const resultSchema = z.object({
  error: z.string().optional(),
  approval: z.union([z.object({ merged: z.string() }), z.object({ blocked: z.string() }), z.object({ refused: z.string() })]).optional(),
  changes: z.union([z.object({ sent: z.string(), moved: z.boolean() }), z.object({ skipped: z.string() }), z.object({ refused: z.string() })]).optional(),
  close: z.union([z.object({ closed: z.string(), pr: z.string() }), z.object({ refused: z.string() })]).optional(),
  retry: z.union([z.object({ retried: z.string() }), z.object({ refused: z.string() })]).optional(),
  attempt: z.union([z.object({ started: z.number() }), z.object({ refused: z.string() })]).optional(),
  answer: z.union([z.object({ delivered: z.string() }), z.object({ refused: z.string() })]).optional(),
});

/** What the runner made of an intent: the result it stored, said for the owner. */
export function describeOutcome(kind: (typeof INBOX_INTENTS)[number], raw: string | null): IntentOutcome {
  const result = resultSchema.safeParse(raw ? JSON.parse(raw) : {}).data;
  if (!result) return { status: "failed", message: "The runner's answer could not be read." };
  if (result.error) return { status: "failed", message: `The runner could not do it: ${result.error}` };
  switch (kind) {
    case "approve_merge": {
      const a = result.approval;
      if (!a) break;
      if ("merged" in a) return { status: "done", message: `Merged as ${a.merged.slice(0, 7)}. The factory now watches main.` };
      return { status: "failed", message: "blocked" in a ? `Not merged: ${a.blocked}` : a.refused };
    }
    case "request_changes": {
      const c = result.changes;
      if (!c) break;
      if ("sent" in c) return { status: "done", message: c.moved ? "Sent to the agent. The job is back in implementing." : "Sent to the agent." };
      return "refused" in c ? { status: "failed", message: c.refused } : { status: "done", message: `Nothing sent: ${c.skipped}.` };
    }
    case "close_job": {
      const c = result.close;
      if (!c) break;
      return "closed" in c ? { status: "done", message: c.pr === "closed" ? "Closed the pull request and the job." : "Closed the job." } : { status: "failed", message: c.refused };
    }
    case "answer":
      if (!result.answer) break;
      return "delivered" in result.answer ? { status: "done", message: "Answer sent. The job resumes." } : { status: "failed", message: result.answer.refused };
    case "retry_stop": {
      const r = result.retry;
      if (!r) break;
      return "retried" in r ? { status: "done", message: "Interrupting the agent again; the job says when it stopped." } : { status: "failed", message: r.refused };
    }
    case "retry_job": {
      const a = result.attempt;
      if (!a) break;
      return "started" in a ? { status: "done", message: `Attempt ${a.started} is queued.` } : { status: "failed", message: a.refused };
    }
    default: {
      const never: never = kind;
      throw new Error(`unknown inbox intent ${String(never)}`);
    }
  }
  return { status: "failed", message: "The runner's answer could not be read." };
}

export async function intentOutcome(deps: Pick<InboxDeps, "db" | "user">, intentId: string): Promise<IntentOutcome> {
  if (!isOwner(await deps.user())) return { status: "failed", message: OWNER_ONLY };
  const [intent] = await deps.db
    .select()
    .from(intents)
    .where(and(eq(intents.id, intentId), inArray(intents.kind, [...INBOX_INTENTS])));
  if (!intent || !intent.id.startsWith("panel:")) return { status: "failed", message: "No such request." };
  if (!intent.handled_at) return { status: "pending" };
  return describeOutcome(intent.kind as (typeof INBOX_INTENTS)[number], intent.result);
}

export type ReviewDeps = Pick<InboxDeps, "db" | "user">;

/**
 * The changed files and Bugbot's findings the inbox shows: what the runner stored with its decision
 * on this report, else read from GitHub here on the server, as when autonomy is off.
 */
export async function inboxReview(deps: ReviewDeps, jobId: JobId): Promise<ReviewSummary | null> {
  if (!isOwner(await deps.user())) return null;
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job?.pr_url || !inboxKind(job)) return null;
  const decision = mergeDecisionSchema.safeParse(job.merge_decision).data;
  if (decision?.review && (decision.stageEventId === job.stage_event_id || decision.merged)) return decision.review;
  const snapshot = githubSnapshotSchema.safeParse(job.github_snapshot).data;
  return snapshot && snapshot.prUrl === job.pr_url && snapshot.attempt === job.attempt ? snapshot.review : null;
}
