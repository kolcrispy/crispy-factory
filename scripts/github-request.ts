import { GitHubError } from "@factory/integrations/github/gh";
import type { GithubRequest } from "@factory/integrations/github/gh";

/** Routes injected GitHub calls to an isolated regression server, never authenticated gh. */
export function githubRequest(port: number): GithubRequest {
  return async (method, path, { body, allow = [] } = {}) => {
    const response = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await response.json();
    if (!response.ok && !allow.includes(response.status)) {
      throw new GitHubError(`GitHub ${method} ${path} answered HTTP ${response.status}.`, response.status);
    }
    return { status: response.status, json };
  };
}
