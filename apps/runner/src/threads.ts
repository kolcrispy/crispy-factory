import type { JobHost } from "@factory/core/host";
import type { ThreadState } from "@factory/core/watchdog";
import { bindingOf } from "./binding";
import { interruptOmp, isOmp, ompSubagents, readOmp, sendOmp } from "./omp";

/** Shared execution observation: activity, last run status, and last assistant message. */
export type ThreadRead = { state: ThreadState; status: string | null; lastMessage: string | null; checkout?: string | null };

/** The thread as a stop sees it: whether a run is active, and the project its subagent threads are listed under. */
export type ThreadActivity = { state: ThreadState; activeRunId: string | null; projectId: string | null };

export type SubagentThread = { threadId: string; status: string; latestRunId: string | null };
export type InterruptOutcome = { kind: "requested" } | { kind: "idle" } | { kind: "refused"; reason: string };

/** Run statuses that are not over; a subagent thread in one of them still works or waits. */
export const ACTIVE_RUN_STATUSES = ["preparing", "queued", "starting", "running", "waiting"];

const GONE: ThreadRead = { state: "gone", status: null, lastMessage: null };


/** Pending launches remain active; unknown adapter identities must never imply completion. */
async function showThread(threadId: string | null, host: JobHost): Promise<{ read: ThreadRead; activity: ThreadActivity }> {
  const gone: { read: ThreadRead; activity: ThreadActivity } = { read: GONE, activity: { state: "gone", activeRunId: null, projectId: null } };
  if (!threadId) return gone;
  if (isOmp(threadId)) return readOmp(threadId);
  // A launch in progress; the runner records the real id or clears the marker.
  if (bindingOf(threadId) === "pending") return { read: { state: "running", status: null, lastMessage: null }, activity: { state: "running", activeRunId: null, projectId: null } };
  throw new Error(`Unsupported execution binding: ${threadId}`);
}

/** OMP execution adapter; injectable for isolated lifecycle regressions. */
export const threads = {
  read: async (threadId: string | null, host: JobHost) => (await showThread(threadId, host)).read,
  activity: async (threadId: string | null, host: JobHost) => (await showThread(threadId, host)).activity,
  state: async (threadId: string | null, host: JobHost) => (await threads.read(threadId, host)).state,
  send: (threadId: string, message: string, _host: JobHost) => sendOmp(threadId, message),
  subagents: (threadId: string, _projectId: string, _host: JobHost) => ompSubagents(threadId),
  interrupt: (threadId: string, _requestId: string, _reason: string, _host: JobHost) => interruptOmp(threadId),
};
