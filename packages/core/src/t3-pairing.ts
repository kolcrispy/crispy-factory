import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "@factory/storage/schema";
import { intents, jobs } from "@factory/storage/schema";
import { isOwner, type SessionUser } from "./auth/owner";
import type { JobId } from "./sources/shapes";

// The owner requests a pairing link from the local runner. The panel takes the result
// once, replacing the stored link; unread links are cleared after the token's TTL.
// The link appears in no log, event or live feed.

export const PAIRING_TTL_MINUTES = 15;

export const pairingSchema = z.object({ pairUrl: z.url(), expiresAt: z.string() });
export type T3Pairing = z.infer<typeof pairingSchema>;

/** What the runner stores for an open_t3 intent, and what remains once the link is gone. */
export const pairingResultSchema = z.union([
  pairingSchema,
  z.object({ refused: z.string() }),
  z.object({ error: z.string() }),
  z.object({ cleared: z.enum(["shown", "expired"]) }),
]);
export type PairingResult = z.infer<typeof pairingResultSchema>;


export type PairingDeps = {
  db: NodePgDatabase<typeof schema>;
  user: () => Promise<SessionUser | null | undefined>;
  now?: () => Date;
};

export type PairingRequest = { ok: true; intentId: string } | { ok: false; message: string };

export type PairingTake =
  | { status: "pending" }
  | { status: "ready"; pairUrl: string; expiresAt: string }
  | { status: "failed"; message: string };

const OWNER_ONLY = "Only the factory owner can open T3.";

/** Records a pairing request for the local runner that owns this thread. */
export async function requestPairing(deps: PairingDeps, jobId: JobId): Promise<PairingRequest> {
  if (!isOwner(await deps.user())) return { ok: false, message: OWNER_ONLY };
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return { ok: false, message: `No job ${jobId}.` };
  if (!job.t3_thread_id || job.t3_thread_id.startsWith("pending:") || !job.machine_id) return { ok: false, message: "This job has no running T3 thread." };
  const id = `panel:open_t3:${randomUUID()}`;
  await deps.db.insert(intents).values({ id, kind: "open_t3", job_id: job.id, created_at: (deps.now ?? (() => new Date()))() });
  return { ok: true, intentId: id };
}

const describeStored = (result: PairingResult): PairingTake => {
  if ("pairUrl" in result) return { status: "ready", pairUrl: result.pairUrl, expiresAt: result.expiresAt };
  if ("refused" in result) return { status: "failed", message: result.refused };
  if ("error" in result) return { status: "failed", message: `The runner could not make a pairing link: ${result.error}` };
  return { status: "failed", message: result.cleared === "shown" ? "This pairing link was already shown." : "This pairing link expired." };
};

/**
 * The runner's answer to an open_t3 intent, taken once: a pairing link is replaced in the same
 * transaction that reads it, and one older than its TTL is cleared instead of shown.
 */
export async function takePairing(deps: PairingDeps, intentId: string): Promise<PairingTake> {
  if (!isOwner(await deps.user())) return { status: "failed", message: OWNER_ONLY };
  const now = (deps.now ?? (() => new Date()))();
  return deps.db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(intents)
      .where(and(eq(intents.id, intentId), eq(intents.kind, "open_t3")))
      .for("update");
    if (!intent) return { status: "failed", message: "No such request." };
    if (!intent.handled_at) return { status: "pending" };
    const parsed = pairingResultSchema.safeParse(intent.result ? JSON.parse(intent.result) : null);
    if (!parsed.success) return { status: "failed", message: "The runner's answer could not be read." };
    if (!("pairUrl" in parsed.data)) return describeStored(parsed.data);
    const expired = now.getTime() - intent.handled_at.getTime() >= PAIRING_TTL_MINUTES * 60_000 || Date.parse(parsed.data.expiresAt) <= now.getTime();
    const cleared: PairingResult = { cleared: expired ? "expired" : "shown" };
    await tx.update(intents).set({ result: JSON.stringify(cleared) }).where(eq(intents.id, intentId));
    return expired ? describeStored(cleared) : describeStored(parsed.data);
  });
}
