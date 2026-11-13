import { db } from "@factory/storage/client";
import type { InboxDeps } from "./inbox-actions";
import { newJobDeps } from "./new-job-deps";

/** Owner dashboard and trusted CLI actions share PostgreSQL intent persistence. */
export function inboxDeps(user: InboxDeps["user"]): InboxDeps {
  return {
    db,
    user,
    newJob: newJobDeps(user),
  };
}
