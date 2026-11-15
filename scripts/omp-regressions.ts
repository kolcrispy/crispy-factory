import "./test-guard";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpRpc, OmpRpcTimeout } from "@factory/integrations/omp-rpc";
import reporting from "@factory/reporting/omp-extension";
import { db } from "@factory/storage/client";

const root = mkdtempSync(join(tmpdir(), "factory-omp-regression-"));
const fixture = join(root, "rpc.ts");
writeFileSync(fixture, `import {createInterface} from "node:readline";
const lines=createInterface({input:process.stdin});
lines.on("line",line=>{const c=JSON.parse(line);
if(c.type==="exit")process.exit(0);
if(c.type==="timeout")return;
setTimeout(()=>console.log(JSON.stringify({type:"response",id:c.id,success:c.type!=="reject",data:{value:c.value},error:"Refused"})),c.delay??0);
});`);
const rpc = new OmpRpc({ command: process.execPath, args: [fixture], cwd: root });
try {
  const [slow, fast] = await Promise.all([
    rpc.request<{ value: string }>({ type: "echo", value: "slow", delay: 30 }),
    rpc.request<{ value: string }>({ type: "echo", value: "fast" }),
  ]);
  assert.equal(slow.value, "slow", "out-of-order replies retain the matching request");
  assert.equal(fast.value, "fast");
  await assert.rejects(rpc.request({ type: "reject" }), /Refused/);
  await assert.rejects(rpc.request({ type: "timeout" }, 20), /delivery is uncertain/);
  assert.equal((await rpc.request<{ value: string }>({ type: "echo", value: "after-timeout" })).value, "after-timeout", "one uncertain command does not poison later requests");
  await assert.rejects(rpc.request({ type: "get_state", delay: 100 }, 20), error => error instanceof OmpRpcTimeout && error.command === "get_state" && !error.message.includes("delivery is uncertain"));
  let schema: Record<string, unknown> | undefined;
  reporting({ registerTool: tool => { schema = tool.parameters; } });
  assert.deepEqual(schema?.required, ["action", "summary"], "the runtime receives the builder report JSON Schema");
  assert.equal((schema?.properties as Record<string, { type: string }>).action.type, "string");
  const pending = rpc.request({ type: "timeout" });
  rpc.reply({ type: "exit" });
  await assert.rejects(pending, /exited/);
  const { ompRuntime, readOmp, recoverOmp, startOmp, ompIdentity } = await import("@factory/runner/omp");
  const originalRoot = ompRuntime.root;
  ompRuntime.root = root;
  const id = "omp:review:missing-transcript:1:1";
  const recordPath = join(root, `${createHash("sha256").update(id).digest("hex")}.json`);
  const record = { id, jobId: "internal:missing", key: "missing-transcript", attempt: 1, repo: "fixture/repo", role: "reviewer", branch: "review/fixture", cwd: root, model: "fixture", sessionDir: root, started: true, delivery: "accepted", needsResume: true };
  try {
    writeFileSync(recordPath, JSON.stringify({ ...record, pid: process.pid }));
    await assert.rejects(readOmp(id), /refusing duplicate execution/, "a missing transcript must not hide a live owner");
    writeFileSync(recordPath, JSON.stringify(record));
    assert.equal((await readOmp(id)).read.state, "gone", "a stopped session without a transcript must allow owner-requested fresh review");
    await assert.rejects(recoverOmp(record.key, 1, id, record.jobId), /no persisted transcript/, "missing transcripts still prohibit resuming the original session");
    await assert.rejects(recoverOmp(record.key, 1, id, "internal:new-job"), /another job/, "a reused display key must not recover a prior job's execution");
    assert.notEqual(ompIdentity("internal:old", 1), ompIdentity("internal:new", 1), "separate job UUIDs cannot share execution identity after a display-key reset");
    await assert.rejects(startOmp({ jobId: "internal:new-job", key: record.key, attempt: 1, repo: record.repo, branch: "factory/JOB-1", threadTitle: "New job", message: "new prompt", harness: { provider: "omp", model: "fixture" }, base: "main" }, root, root, { id, cwd: root }), /another job/, "launch cannot adopt another job's durable reservation or send its prompt");
    const missing = { ...record, id: "omp:missing-worktree", cwd: join(root, "missing-worktree"), started: false, pendingMessage: "not delivered" };
    writeFileSync(join(root, `${createHash("sha256").update(missing.id).digest("hex")}.json`), JSON.stringify(missing));
    await assert.rejects(startOmp({ jobId: missing.jobId, key: missing.key, attempt: 1, repo: missing.repo, branch: missing.branch, threadTitle: "Missing checkout", message: "not delivered", harness: { provider: "omp", model: "fixture" }, base: "main" }, root, root, { id: missing.id, cwd: missing.cwd }), /worktree.*missing/, "an incomplete reviewer reservation must not spawn OMP in a missing checkout");
    const checkout = join(root, "checkout");
    for (const args of [["init", checkout], ["-C", checkout, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "baseline"], ["-C", checkout, "branch", "factory/collision"]]) {
      const result = Bun.spawnSync(["git", ...args]);
      assert.equal(result.exitCode, 0, result.stderr.toString());
    }
    const entry = { jobId: "internal:collision", key: "JOB-2", attempt: 1, repo: "fixture/repo", branch: "factory/collision", threadTitle: "Collision", message: "not delivered", harness: { provider: "omp" as const, model: "fixture" }, base: "HEAD" };
    for (let retry = 0; retry < 2; retry++) {
      await assert.rejects(startOmp(entry, checkout, root), error => error instanceof Error && /worktree preparation failed/.test(error.message) && "executionUncertain" in error && error.executionUncertain === true, "initial and reserved launches hold branch collisions without spawning OMP or recycling the queue");
    }
  } finally { ompRuntime.root = originalRoot; }
  console.log("OMP RPC correlation, uncertain delivery, process exit and portable reporting schema regressions passed");
} finally {
  await rpc.close();
  rmSync(root, { recursive: true, force: true });
  await db.$client.end();
}
