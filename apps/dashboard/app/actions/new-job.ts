"use server";

import { getOwner } from "../../lib/auth/server";
import { createJob as create } from "@factory/core/new-job";
import { newJobDeps } from "@factory/core/new-job-deps";
import type { NewJob } from "@factory/core/new-job-schema";

export async function createJob(input: NewJob) {
  return create(newJobDeps(getOwner), input);
}
