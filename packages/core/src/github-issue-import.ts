import { z } from "zod";
import { isOwner } from "./auth/owner";
import { issueUrlSchema } from "./github-issue-schema";
import { createJob, type NewJobDeps } from "./new-job";
import { fetchGithubIssue } from "./github-issue-client";

export async function previewGithubIssue(deps: NewJobDeps, input: unknown) {
  if (!isOwner(await deps.user())) return { ok: false as const, message: "Only the factory owner can import issues." };
  try {
    const { url } = z.object({ url: issueUrlSchema }).parse(input);
    return { ok: true as const, issue: await (deps.readIssue ?? fetchGithubIssue)(url) };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : "Issue lookup failed." }; }
}

export async function importGithubIssue(deps: NewJobDeps, input: unknown) {
  const owner = await deps.user();
  if (!isOwner(owner)) return { ok: false as const, status: 403 as const, message: "Only the factory owner can import issues." };
  try {
    const parsed = z.object({ url: issueUrlSchema, requestId: z.uuid(), provider: z.string().optional() }).parse(input);
    const receipt = await deps.issueReceipt?.(parsed.requestId, parsed.url, owner!.email, parsed.provider);
    if (receipt) return { ok: true as const, identifier: receipt.key, url: receipt.url };
    const issue = await (deps.readIssue ?? fetchGithubIssue)(parsed.url);
    return await createJob({ ...deps, readIssue: async () => issue }, { ...parsed, issueUrl: issue.url, repo: issue.repo, title: issue.title, description: issue.description });
  } catch (error) { return { ok: false as const, status: 400 as const, message: error instanceof Error ? error.message : "Issue import failed." }; }
}
