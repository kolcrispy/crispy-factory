import type { JobRow } from "@factory/storage/schema";
import type { Stage } from "./events";
import { attemptBranch } from "./factory";

// inferred: runner-owned claim, review and verified publication transitions.
// changes: the owner asked for changes on the PR, in the inbox or in a GitHub review.
// budget: posted only by runners from before the budget cap was removed; kept so their events still read.
export const RUNNER_CAUSES = ["resume", "conflict", "merged", "watchdog", "budget", "stop", "closed", "reclaim", "inferred", "changes"] as const;
export type RunnerCause = (typeof RUNNER_CAUSES)[number];
export type Cause = "report" | RunnerCause;

export const runnerEventId = (cause: RunnerCause, ...parts: (string | number)[]) => [cause, ...parts].join(":");

export function causeOf(eventId: string): Cause {
  const prefix = eventId.slice(0, eventId.indexOf(":"));
  return (RUNNER_CAUSES as readonly string[]).includes(prefix) ? (prefix as RunnerCause) : "report";
}

const ACTIVE = { inferred: ["building", "reviewing", "ready"], resume: ["queued", "building", "reviewing"], stop: ["failed"], closed: ["failed"], merged: ["done"] } as const;

export const STAGE_TRANSITIONS: { readonly [From in Stage]: { readonly [C in Cause]?: readonly Stage[] } } = {
  queued: ACTIVE,
  building: ACTIVE,
  reviewing: { ...ACTIVE, changes: ["building"] },
  ready: { conflict: ["building"], changes: ["building"], stop: ["failed"], closed: ["failed"], merged: ["done"] },
  done: {},
  failed: { reclaim: ["queued"], merged: ["done"] },
};

export const canTransition = (from: Stage, to: Stage, cause: Cause) =>
  STAGE_TRANSITIONS[from][cause]?.includes(to) ?? false;

export type StageRow = Pick<JobRow, "key" | "stage" | "stage_at" | "attempt" | "stage_event_id">;
export type StageMove = { stage: Stage; at: Date; eventId: string; branch?: string };

/**
 * What ingest does with a stage event for a claimed job. A skip is ordering or a duplicate, and
 * the run still records the report under its own rules. A refusal is a move the table forbids:
 * neither the job nor the run takes it, and the stored event says why.
 */
export type StageVerdict =
  | { outcome: "apply"; cause: Cause }
  | { outcome: "skip"; cause: Cause; reason: "already applied" | "stale" | "earlier attempt" }
  | { outcome: "refuse"; cause: Cause; reason: string };

export function decideStage(row: StageRow, move: StageMove): StageVerdict {
  const cause = causeOf(move.eventId);
  if (row.stage_event_id === move.eventId) return { outcome: "skip", cause, reason: "already applied" };
  if (row.stage_at && move.at < row.stage_at) return { outcome: "skip", cause, reason: "stale" };
  if (move.branch && move.branch !== attemptBranch(row.key, row.attempt)) return { outcome: "skip", cause, reason: "earlier attempt" };
  if (!canTransition(row.stage, move.stage, cause)) {
    return { outcome: "refuse", cause, reason: `${row.stage} -> ${move.stage} (${cause}) is not in STAGE_TRANSITIONS` };
  }
  return { outcome: "apply", cause };
}
