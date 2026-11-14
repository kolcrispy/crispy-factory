import { db } from "@factory/storage/client";
import { machines } from "@factory/storage/schema";
import { reportedHarnesses } from "./machine";
import { readRegistry } from "./repositories";
import type { NewJobDeps } from "./new-job";
import { fileInternalJob } from "./internal-jobs";

import { eq } from "drizzle-orm";
import { jobs } from "@factory/storage/schema";
import { SOURCE_SHAPES } from "./sources/shapes";
/** Shared database submission path for authenticated dashboard owners and trusted CLI operators. */
export const newJobDeps = (user: NewJobDeps["user"]): NewJobDeps => ({
  user,
  file: (draft, actor) => fileInternalJob(db, draft, actor),
  harnesses: async () => reportedHarnesses(await db.select().from(machines), Date.now()),
  registry: () => readRegistry(db),
  issueReceipt: async (requestId, issueUrl, actor, provider) => {
    const [existing] = await db.select().from(jobs).where(eq(jobs.id, `internal:${requestId}`));
    if (!existing) return null;
    const state = SOURCE_SHAPES.internal.sourceState.parse(existing.source_state);
    if (state.issueUrl !== issueUrl || state.actor !== actor || state.requestedProvider !== provider) throw new Error("This request ID already belongs to a different job submission.");
    return { key: existing.key, url: existing.url };
  },
});
