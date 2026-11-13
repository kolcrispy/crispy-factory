"use server";

import { auth } from "../../lib/auth/server";
import { archiveJobs as archive, unarchiveJobs as unarchive } from "@factory/core/archive-actions";
import { inboxDeps } from "@factory/core/inbox-deps";
import type { JobId } from "@factory/core/sources/shapes";

const deps = inboxDeps(async () => (await auth.getSession()).data?.user);

export async function archiveJobs(ids: JobId[]) {
  return archive(deps, ids);
}

export async function unarchiveJobs(ids: JobId[]) {
  return unarchive(deps, ids);
}
