import { db } from "@factory/storage/client";
import { machines } from "@factory/storage/schema";
import { reportedHarnesses } from "./machine";
import { readRegistry } from "./repositories";
import type { NewJobDeps } from "./new-job";
import { panelSource } from "./sources/index";

/** How the panel files a job: in its source (lib/sources), as the signed-in owner, with the harnesses the machines report and the registered repos. */
export const newJobDeps = (user: NewJobDeps["user"]): NewJobDeps => ({
  user,
  file: (draft) => panelSource().file!(draft),
  harnesses: async () => reportedHarnesses(await db.select().from(machines), Date.now()),
  registry: () => readRegistry(db),
});
