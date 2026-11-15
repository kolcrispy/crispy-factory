import "./test-guard";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkedTool, verifyRunnerCredential } from "./agent-tools.mjs";

for (const result of [{ hasError: true }, { isError: true }, { details: { errorKind: "ambiguous_boundary" } }]) {
  await assert.rejects(checkedTool(Promise.resolve(result)), /Tool failed/);
}
let received = "";
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  received = request.headers.get("authorization") ?? "";
  return received === "Bearer saved-token" ? Response.json({ version: 1, jobs: [] }) : new Response("", { status: 401 });
} });
const dir = await mkdtemp(join(tmpdir(), "factory-credential-"));
try {
  const path = join(dir, "realtime.json");
  await writeFile(path, JSON.stringify({ url: `http://127.0.0.1:${server.port}`, token: "saved-token" }));
  assert.deepEqual(await verifyRunnerCredential(path), { authenticated: true, jobs: 0 });
  assert.equal(received, "Bearer saved-token");
  await writeFile(path, JSON.stringify({ url: `http://127.0.0.1:${server.port}`, token: "stale-token" }));
  await assert.rejects(verifyRunnerCredential(path), /rejected \(401\)/);
} finally { server.stop(true); await rm(dir, { recursive: true, force: true }); }
console.log("Checked tool and persisted credential regressions passed");
