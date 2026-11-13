import "./test-guard";
import assert from "node:assert/strict";
import { ghClient } from "@factory/integrations/github/gh";
import { github, parsePullUrl, pullsClient } from "@factory/integrations/github/pulls";

assert.deepEqual(parsePullUrl("https://github.com/o/r/pull/12/files?w=1"), { repo: "o/r", number: 12 });
assert.throws(() => parsePullUrl("https://gitlab.com/o/r/pull/1"), /not a GitHub pull request URL/);
await assert.rejects(github.pullRequest("https://github.com/o/r/pull/1"), /regression run/, "real authenticated gh is forbidden during regressions");

const seen: { method: string; path: string; body: unknown }[] = [];
const pulls: Record<number, object> = {
  1: { state: "open", merged_at: null, closed_at: null, mergeable: null, head: { sha: "h1" }, title: "PR 1" },
  2: { state: "open", merged_at: null, closed_at: null, mergeable: false, head: { sha: "h2" }, title: "PR 2", html_url: "https://github.com/o/r/pull/2" },
  3: { state: "closed", merged_at: "2026-10-24T10:00:00Z", closed_at: "2026-10-24T10:00:00Z", mergeable: null, head: { sha: "h3" }, title: "PR 3", html_url: "https://github.com/o/r/pull/3" },
};
const request = ghClient(async (_command, args, options) => {
  const url = new URL(String(args[1]), "https://github.invalid");
  const method = String(args[args.indexOf("--method") + 1]);
  seen.push({ method, path: url.pathname + url.search, body: options?.input ? JSON.parse(String(options.input)) : undefined });
  let status = 200;
  let body: unknown;
  if (url.pathname === "/repos/o/r/pulls") {
    const branch = url.searchParams.get("head");
    body = branch === "o:factory/JOB-1" ? [pulls[3], { ...pulls[2], state: "closed" }] : branch === "o:factory/JOB-2" ? [pulls[3], pulls[2]] : [{ ...pulls[2], state: "closed" }];
  } else {
    const pull = /^\/repos\/o\/r\/pulls\/(\d+)(\/merge)?$/.exec(url.pathname);
    const n = Number(pull?.[1]);
    if (pull?.[2] && method === "PUT") {
      status = n === 1 ? 200 : n === 2 ? 405 : n === 3 ? 409 : 422;
      body = n === 1 ? { sha: "merge-sha", merged: true } : { message: n === 2 ? "Pull Request is not mergeable" : "Head changed" };
    } else if (pull && pulls[n]) {
      body = pulls[n];
    } else {
      status = 404;
      body = { message: "Not Found" };
    }
  }
  return { stdout: `HTTP/2.0 ${status}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`, stderr: "" };
});
const client = pullsClient({ request });
const url = (n: number) => `https://github.com/o/r/pull/${n}`;
assert.deepEqual(await client.pullRequest(url(1)), { state: "open", mergeable: "unknown", headSha: "h1", title: "PR 1" });
assert.deepEqual(await client.pullRequest(url(2)), { state: "open", mergeable: "conflicting", headSha: "h2", title: "PR 2" });
assert.equal((await client.pullRequest(url(3))).state, "merged");
await assert.rejects(client.pullRequest(url(9)), /HTTP 404/);
assert.deepEqual(await client.pullsForHead("o/r", "factory/JOB-1"), [
  { state: "merged", headSha: "h3", mergedAt: new Date("2026-10-24T10:00:00Z"), closedAt: new Date("2026-10-24T10:00:00Z") },
  { state: "closed", headSha: "h2", mergedAt: null, closedAt: null },
]);
assert.deepEqual(await client.pullRequestForBranch("o/r", "factory/JOB-2"), { url: url(2), state: "open" }, "an open PR wins over a merged one");
assert.deepEqual(await client.pullRequestForBranch("o/r", "factory/JOB-1"), { url: url(3), state: "merged" });
assert.equal(await client.pullRequestForBranch("o/r", "factory/JOB-3"), null, "closed unmerged PRs do not count");
assert.deepEqual(await client.mergePull(url(1), "h1"), { kind: "merged", sha: "merge-sha" });
assert.deepEqual(await client.mergePull(url(2), "h2"), { kind: "not_mergeable", message: "Pull Request is not mergeable" });
assert.equal((await client.mergePull(url(3), "stale")).kind, "head_moved");
await assert.rejects(client.mergePull(url(4), "h4"), /HTTP 422/);
assert.deepEqual(seen.find((s) => s.method === "PUT")?.body, { merge_method: "squash", sha: "h1" }, "merges pin the reviewed head");
console.log("github regressions passed");
