import { exec, type ExecError } from "@factory/platform/exec";
import { forbidInTest } from "@factory/core/test-mode";

export type RepoName = `${string}/${string}`;
export type GithubResponse = { status: number; json: unknown };
export type GithubRequest = (method: string, path: string, options?: { body?: unknown; allow?: number[] }) => Promise<GithubResponse>;

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** gh owns credentials; tokens are never exported to the dashboard or subprocess arguments. */
export function ghClient(run = exec): GithubRequest {
  return async (method, path, { body, allow = [] } = {}) => {
    if (run === exec) forbidInTest("the authenticated gh CLI");
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("GitHub API paths must be relative to the authenticated host.");
    const args = ["api", path, "--method", method, "--include", "--header", "Accept: application/vnd.github+json"];
    if (body !== undefined) args.push("--input", "-");
    let output: string;
    try {
      output = (await run("gh", args, { input: body === undefined ? undefined : JSON.stringify(body), timeoutMs: 30_000, maxBuffer: 16 * 1024 * 1024 })).stdout;
    } catch (error) {
      output = (error as ExecError).stdout ?? "";
      if (!/^HTTP\/\S+ \d{3}/.test(output)) throw new Error("gh could not reach GitHub. Check gh auth status and connectivity.");
    }
    const separator = /\r?\n\r?\n/.exec(output);
    const status = Number(/^HTTP\/\S+ (\d{3})/.exec(output)?.[1]);
    if (!separator || !status) throw new Error("gh returned an invalid HTTP response.");
    const text = output.slice(separator.index + separator[0].length);
    let json: unknown = null;
    if (text.trim()) {
      try { json = JSON.parse(text); } catch { throw new Error(`GitHub returned invalid JSON (HTTP ${status}).`); }
    }
    if ((status < 200 || status >= 300) && !allow.includes(status)) {
      throw new GitHubError(`GitHub ${method} ${path.split("?")[0]} answered HTTP ${status}.`, status);
    }
    return { status, json };
  };
}

export const ghRequest = ghClient();
