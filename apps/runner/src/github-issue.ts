import { z } from "zod";
import { ghRequest, type GithubRequest } from "@factory/integrations/github/gh";
import { githubIssueSchema, issueIdentity } from "@factory/core/github-issue-schema";
import { readRegistry } from "@factory/core/repositories";
import { db } from "@factory/storage/client";

export async function readGithubIssue(url: string, request: GithubRequest = ghRequest) {
  const identity = issueIdentity(url);
  const registry = await readRegistry(db);
  if (!registry.some(row => row.repo.toLowerCase() === identity.repo && row.enabled && row.registration_status === "ready")) throw new Error(`${identity.repo} is not a ready, enabled repository.`);
  const response = await request("GET", `/repos/${identity.repo}/issues/${identity.number}`);
  const issue = z.object({ title: z.string(), body: z.string().nullable(), state: z.string(), pull_request: z.unknown().optional() }).parse(response.json);
  if (issue.pull_request) throw new Error("Pull requests cannot be imported as issues.");
  if (issue.state !== "open") throw new Error("Only open GitHub issues can be imported.");
  return githubIssueSchema.parse({ ...identity, title: issue.title, description: issue.body ?? "" });
}
