import { db } from "@factory/storage/client";
import { machines } from "@factory/storage/schema";
import { reportedHarnesses } from "./machine";
import { readRegistry } from "./repositories";
import type { NewJobDeps } from "./new-job";
import { fileInternalJob } from "./internal-jobs";

/** Shared database submission path for authenticated dashboard owners and trusted CLI operators. */
export const newJobDeps = (user: NewJobDeps["user"]): NewJobDeps => ({
  user,
  file: (draft, actor) => fileInternalJob(db, draft, actor),
  harnesses: async () => reportedHarnesses(await db.select().from(machines), Date.now()),
  registry: () => readRegistry(db),
});
