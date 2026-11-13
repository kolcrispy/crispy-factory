import "./test-guard";
import assert from "node:assert/strict";
import { ghClient, GitHubError } from "@factory/integrations/github/gh";
import { pullsClient } from "@factory/integrations/github/pulls";

const requests: { command: string; args: string[]; input?: string }[] = [];
const client = ghClient(async (command, args, options) => {
  requests.push({ command, args, input: options?.input });
  return { stdout: 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"ok":true}', stderr: "" };
});
assert.deepEqual(await client("POST", "/graphql", { body: { query: "query { viewer { login } }" } }), { status: 200, json: { ok: true } });
assert.equal(requests[0]!.command, "gh");
assert.ok(requests[0]!.args.includes("--input"));
assert.equal(requests[0]!.args.includes("query { viewer { login } }"), false, "request payload must travel over stdin, not argv");
assert.equal(JSON.parse(requests[0]!.input!).query, "query { viewer { login } }");
const denied = ghClient(async () => { throw Object.assign(new Error("command failed"), { stdout: 'HTTP/2.0 403 Forbidden\n\n{"message":"denied"}' }); });
await assert.rejects(denied("GET", "/repos/o/r"), (error: unknown) => error instanceof GitHubError && error.status === 403);
assert.equal((await denied("GET", "/repos/o/r", { allow: [403] })).status, 403, "allowed HTTP failures retain their response for caller policy");
await assert.rejects(client("GET", "https://other.example/"), /relative/);
const pulls = pullsClient({ request: async () => ({ status: 200, json: { state: "open", merged_at: null, closed_at: null, head: { sha: "head" }, mergeable: false, title: "Conflict" } }) });
assert.deepEqual(await pulls.pullRequest("https://github.com/o/r/pull/1"), { state: "open", mergeable: "conflicting", headSha: "head", title: "Conflict" });
console.log("gh stdin payload, HTTP refusal, allowed response, host confinement, and pull-state regressions passed");
