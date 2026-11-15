import { attemptBranch, parseBranch } from "./factory";
import { currentBranch } from "./git-head";


export type ReportIdentity = { jobKey: string; branch: string; sessionId: string; repo?: string };

/** Trusted direct sessions supply their explicit attempt and execution identity. */
export function reportIdentity(env: Readonly<Record<string, string | undefined>>, cwd: string, branchOf: (cwd: string) => string | undefined = currentBranch): ReportIdentity | undefined {
  const attempt = Number(env.FACTORY_ATTEMPT ?? "1");
  const branch = env.FACTORY_JOB_KEY ? (Number.isInteger(attempt) && attempt > 0 ? attemptBranch(env.FACTORY_JOB_KEY, attempt) : undefined) : branchOf(cwd);
  const jobKey = parseBranch(branch)?.key;
  if (!branch || !jobKey || !env.FACTORY_SESSION_ID) return undefined;
  return { jobKey, branch, sessionId: env.FACTORY_SESSION_ID, ...(env.FACTORY_REPO && { repo: env.FACTORY_REPO }) };
}

