"use server";

import { getOwner } from "../../lib/auth/server";
import {
  answerQuestion as answer,
  approveFromRunDetail as approveInRunDetail,
  approveMerge as approve,
  closeJob as close,
  dismissJob as dismiss,
  fileFollowUp as followUp,
  intentOutcome as outcome,
  requestChanges as changes,
  retryFailed as retryJob,
  retryStop as retry,
} from "@factory/core/inbox-actions";
import { inboxDeps } from "@factory/core/inbox-deps";
import type { JobId } from "@factory/core/sources/shapes";

const deps = inboxDeps(getOwner);

export async function approveMerge(jobId: JobId, requestId: string, headSha: string | null) {
  return approve(deps, jobId, requestId, headSha);
}

export async function approveFromRunDetail(jobId: JobId, requestId: string, headSha: string) {
  return approveInRunDetail(deps, jobId, requestId, headSha);
}

export async function requestChanges(jobId: JobId, requestId: string, body: string) {
  return changes(deps, jobId, requestId, body);
}

export async function fileFollowUp(jobId: JobId, requestId: string, body: string) {
  return followUp(deps, jobId, requestId, body);
}

export async function answerQuestion(jobId: JobId, requestId: string, body: string) {
  return answer(deps, jobId, requestId, body);
}

export async function closeJob(jobId: JobId, requestId: string, reason: string) {
  return close(deps, jobId, requestId, reason);
}

export async function retryStop(jobId: JobId, requestId: string) {
  return retry(deps, jobId, requestId);
}

export async function retryFailed(jobId: JobId, requestId: string, note: string) {
  return retryJob(deps, jobId, requestId, note);
}

export async function dismissJob(jobId: JobId) {
  return dismiss(deps, jobId);
}

export async function inboxIntentOutcome(intentId: string) {
  return outcome(deps, intentId);
}
