import { db } from "@factory/storage/client";
import type { InboxDeps } from "./inbox-actions";
import { newJobDeps } from "./new-job-deps";
import { sourceFor } from "./sources/index";

/** The inbox actions as the panel's server runs them, acting as `user`: the panel's session, or the owner a Slack click proved. */
export function inboxDeps(user: InboxDeps["user"]): InboxDeps {
  return {
    db,
    user,
    reply: async (job, requestId, body) => {
      const reply = sourceFor(job.source).reply;
      if (!reply) throw new Error(`${job.source} jobs can't be answered from the panel`);
      await reply(job, requestId, body);
    },
    newJob: newJobDeps(user),
  };
}
