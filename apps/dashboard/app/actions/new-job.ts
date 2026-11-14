"use server";

import { getOwner } from "../../lib/auth/server";
import { createJob as create } from "@factory/core/new-job";
import { newJobDeps } from "@factory/core/new-job-deps";
import type { NewJob } from "@factory/core/new-job-schema";
import { previewGithubIssue as preview } from "@factory/core/github-issue-import";

export async function createJob(input: NewJob) {
  return create(newJobDeps(getOwner), input);
}

export async function previewGithubIssue(input: { url: string }) {
  return preview(newJobDeps(getOwner), input);
}
