import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { jobs, intents } from "@factory/storage/schema";
import { isOwner } from "./auth/owner";
import type { InboxDeps } from "./inbox-actions";
import { reviewOverridesSchema } from "./review";

export const reviewActionSchema = z.object({
  requestId: z.uuid(), jobId: z.string().min(1), attempt: z.number().int().positive(),
  action: z.enum(["review", "changes"]), body: z.string().trim().max(4000).default(""),
}).refine(value => value.action !== "changes" || value.body.length > 0, { message: "Describe the requested changes." });

export async function requestReviewAction(deps: Pick<InboxDeps, "db" | "user">, raw: unknown) {
  const owner = await deps.user();
  if (!isOwner(owner)) return { ok: false as const, message: "Only the owner can act on review." };
  const parsed = reviewActionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]!.message };
  const input = parsed.data;
  const id = `review-action:${input.requestId}`;
  const detail = JSON.stringify({ ...input, actor: owner!.email });
  const [prior] = await deps.db.select().from(intents).where(eq(intents.id, id));
  if (prior) return prior.detail === detail ? { ok: true as const, intentId: id } : { ok: false as const, message: "Request ID belongs to a different review action." };
  const [job] = await deps.db.select().from(jobs).where(and(eq(jobs.id, input.jobId as typeof jobs.$inferSelect.id), eq(jobs.attempt, input.attempt)));
  if (!job?.attempt_review?.policy.enabled || job.attempt_review.state !== "held" || job.stop || ["failed", "merged"].includes(job.stage)) return { ok: false as const, message: "This attempt has no held review." };
  await deps.db.insert(intents).values({ id, kind: "review_action", job_id: job.id, detail, created_at: new Date() }).onConflictDoNothing();
  const [existing] = await deps.db.select().from(intents).where(eq(intents.id, id));
  if (existing?.detail !== detail) return { ok: false as const, message: "Request ID belongs to a different review action." };
  return { ok: true as const, intentId: id };
}

/** Updates future attempts only; an already claimed attempt keeps its snapshot. */
export async function saveJobReview(deps: Pick<InboxDeps, "db" | "user">, raw: unknown) {
  if (!isOwner(await deps.user())) return { ok: false as const, message: "Only the owner can configure review." };
  const parsed = z.object({ jobId: z.string().min(1), review: reviewOverridesSchema }).safeParse(raw);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]!.message };
  const changed = await deps.db.update(jobs).set({ review_overrides: parsed.data.review, updated_at: new Date() })
    .where(eq(jobs.id, parsed.data.jobId as typeof jobs.$inferSelect.id)).returning({ id: jobs.id });
  return changed.length ? { ok: true as const } : { ok: false as const, message: "Job not found." };
}
