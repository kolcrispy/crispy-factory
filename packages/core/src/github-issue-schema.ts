import { z } from "zod";

export function issueIdentity(value: string) {
  const url = new URL(value.trim());
  const match = /^\/([^/]+)\/([^/]+)\/issues\/([1-9][0-9]*)\/?$/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || !match || !/^[\w.-]+$/.test(match[1]!) || !/^[\w.-]+$/.test(match[2]!) || [match[1], match[2]].some(p => p === "." || p === "..")) throw new Error("Use a github.com issue URL, not a pull request.");
  const repo = `${match[1]}/${match[2]}`.toLowerCase();
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number)) throw new Error("Invalid issue number.");
  return { repo, number, url: `https://github.com/${repo}/issues/${number}` };
}

export const issueUrlSchema = z.string().trim().transform((value, ctx) => {
  try { return issueIdentity(value).url; }
  catch { ctx.addIssue({ code: "custom", message: "Use a github.com issue URL, not a pull request." }); return z.NEVER; }
});
export const githubIssueSchema = z.object({ url: issueUrlSchema, repo: z.string(), number: z.number().int().positive(), title: z.string().min(3).max(200), description: z.string().max(10_000) });
export type GithubIssue = z.infer<typeof githubIssueSchema>;
