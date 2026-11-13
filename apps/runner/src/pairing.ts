import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { jobs } from "@factory/storage/schema";
import { localHost } from "@factory/core/host";
import { pairingSchema, PAIRING_TTL_MINUTES, type PairingResult } from "@factory/core/t3-pairing";
import type { JobId } from "@factory/core/sources/shapes";

/** Let T3 resolve its configured endpoint; no dashboard process receives local credentials. */
export async function openT3(id: JobId): Promise<PairingResult> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job?.t3_thread_id || job.t3_thread_id.startsWith("pending:")) return { refused: "This job has no running T3 thread." };
  const { stdout } = await localHost.run(localHost.t3, ["auth", "pairing", "create", "--ttl", `${PAIRING_TTL_MINUTES}m`, "--label", "factory-panel", "--json"], { timeoutMs: 60_000 });
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { throw new Error("T3 returned no pairing response."); }
  const result = pairingSchema.safeParse(parsed);
  if (!result.success) throw new Error("T3 returned no valid pairing link.");
  return result.data;
}
