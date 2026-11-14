import { z } from "zod";
import { loadConfig } from "./config";
import { githubIssueSchema, issueUrlSchema } from "./github-issue-schema";

export async function fetchGithubIssue(url: string) {
  const canonical = issueUrlSchema.parse(url);
  const config = loadConfig();
  let response: Response;
  try {
    response = await fetch(new URL("/github-issue", config.ingestUrl), { method: "POST", headers: { authorization: `Bearer ${config.secret}`, "content-type": "application/json" }, body: JSON.stringify({ url: canonical }), signal: AbortSignal.timeout(35_000) });
  } catch { throw new Error("The runner is offline or unreachable. No job was created."); }
  const result = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), issue: githubIssueSchema }), z.object({ ok: z.literal(false), message: z.string() })]).parse(await response.json());
  if (!result.ok) throw new Error(result.message);
  return result.issue;
}
