import { db } from "@factory/storage/client";
import { ingest, type IngestResult } from "@factory/core/ingest";
import { ingestBodySchema } from "@factory/core/events";

/** Runner events share the same transactional projection as loopback agent reports. */
export const ingestClient = {
  async post(event: Record<string, unknown>): Promise<Pick<IngestResult, "refused">> {
    return ingest(db, ingestBodySchema.parse(event));
  },
};

export async function postEvent(event: Record<string, unknown>) {
  const { refused } = await ingestClient.post(event);
  for (const refusal of refused) console.log(JSON.stringify({ at: new Date().toISOString(), event: "stage refused", ...refusal }));
}
