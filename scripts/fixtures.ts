import type { jobs, runs } from "@factory/storage/schema";
import { attemptBranch } from "@factory/core/factory";
import { jobId } from "@factory/core/sources/shapes";

export function internalJob(
  externalId: string,
  key: string,
  overrides: Partial<typeof jobs.$inferInsert> = {},
): typeof jobs.$inferInsert {
  const now = new Date();
  return {
    id: jobId("internal", externalId),
    source: "internal",
    external_id: externalId,
    key,
    title: "t",
    url: `/jobs/${key}`,
    repo: "ski043/factory-demo",
    writeback: {},
    source_state: { actor: "owner@example.com" },
    claimed_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** A run on the job's attempt branch with usage recorded, as ingest projects it, so its cost is known. */
export function usageRun(
  key: string,
  model = "claude-opus-5-5",
  tokens: { input?: number; output?: number; cacheRead?: number } = {},
  attempt = 1,
): typeof runs.$inferInsert {
  const now = new Date();
  return {
    session_id: `usage:${attemptBranch(key, attempt)}`,
    branch: attemptBranch(key, attempt),
    job_key: key,
    model,
    started_at: now,
    last_event_at: now,
    input_tokens: tokens.input ?? 10_000,
    output_tokens: tokens.output ?? 2_000,
    cache_read_tokens: tokens.cacheRead ?? 50_000,
  };
}
