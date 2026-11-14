import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type * as schema from "@factory/storage/schema";
import { jobs, repoSettings } from "@factory/storage/schema";
import { REPO_NAME } from "./repo-name";
import { issueUrlSchema } from "./github-issue-schema";
import { SOURCE_SHAPES } from "./sources/shapes";
import { reviewOverridesSchema } from "./review";

const inputSchema = z.object({
  requestId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(10_000),
  repo: z.string().regex(REPO_NAME),
  provider: z.string().trim().min(1).optional(),
  issueUrl: issueUrlSchema.optional(),
  review: reviewOverridesSchema.optional(),
});

type Database = NodePgDatabase<typeof schema>;

/** Request identity and the allocated key are committed together, including offline submissions. */
export async function fileInternalJob(database: Database, input: unknown, actor: string) {
  const draft = inputSchema.parse(input);
  if (!actor.trim()) throw new Error("A job requires an audit actor.");
  const id = `internal:${draft.requestId}` as const;
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('crispy-factory internal-jobs'))`);
    const [existing] = await tx.select().from(jobs).where(eq(jobs.id, id));
    if (existing) {
      const state = SOURCE_SHAPES.internal.sourceState.parse(existing.source_state);
      if (existing.title !== draft.title || existing.description !== draft.description || existing.repo !== draft.repo || state.actor !== actor || state.requestedProvider !== draft.provider || state.issueUrl !== draft.issueUrl || JSON.stringify(existing.review_overrides ?? {}) !== JSON.stringify(draft.review ?? {})) {
        throw new Error("This request ID already belongs to a different job submission.");
      }
      return { key: existing.key, url: existing.url };
    }
    const [repository] = await tx.select().from(repoSettings).where(and(eq(repoSettings.repo, draft.repo), eq(repoSettings.enabled, true)));
    if (!repository || repository.registration_status !== "ready") throw new Error(`${draft.repo} is not a ready, enabled repository.`);
    if (draft.issueUrl) {
      const [active] = await tx.select({ key: jobs.key, url: jobs.url }).from(jobs).where(sql`${jobs.source_state}->>'issueUrl' = ${draft.issueUrl} and ${jobs.stage} not in ('merged', 'failed')`).limit(1);
      if (active) throw new Error(`This issue already has active job ${active.key}: ${active.url}`);
    }
    const [sequence] = await tx.select({ next: sql<number>`coalesce(max(substring(${jobs.key} from '^JOB-([0-9]+)$')::bigint), 0) + 1` }).from(jobs);
    const key = `JOB-${sequence!.next}`;
    const now = new Date();
    const url = `/list?job=${encodeURIComponent(key)}`;
    await tx.insert(jobs).values({
      id,
      source: "internal",
      external_id: draft.requestId,
      key,
      title: draft.title,
      description: draft.description,
      repo: draft.repo,
      url,
      writeback: {},
      source_state: { actor, requestedProvider: draft.provider, ...(draft.issueUrl ? { issueUrl: draft.issueUrl } : {}) },
      provider: draft.provider,
      review_overrides: draft.review ?? null,
      claimed_at: now,
      updated_at: now,
    });
    return { key, url };
  });
}
