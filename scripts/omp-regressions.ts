import "./test-guard";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpRpc } from "@factory/integrations/omp-rpc";
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
  let schema: Record<string, unknown> | undefined;
  reporting({ registerTool: tool => { schema = tool.parameters; } });
  assert.deepEqual(schema?.required, ["stage", "summary"], "the runtime receives JSON Schema, not an incompatible Zod object");
  assert.equal((schema?.properties as Record<string, { type: string }>).stage.type, "string");
  const pending = rpc.request({ type: "timeout" });
  rpc.reply({ type: "exit" });
  await assert.rejects(pending, /exited/);
  const { ompRuntime, readOmp, recoverOmp } = await import("@factory/runner/omp");
  const originalRoot = ompRuntime.root;
  ompRuntime.root = root;
  const id = "omp:review:missing-transcript:1:1";
  const recordPath = join(root, `${createHash("sha256").update(id).digest("hex")}.json`);
  const record = { id, key: "missing-transcript", attempt: 1, repo: "fixture/repo", role: "reviewer", branch: "review/fixture", cwd: root, model: "fixture", sessionDir: root, started: true, delivery: "accepted", needsResume: true };
  try {
    writeFileSync(recordPath, JSON.stringify({ ...record, pid: process.pid }));
    await assert.rejects(readOmp(id), /refusing duplicate execution/, "a missing transcript must not hide a live owner");
    writeFileSync(recordPath, JSON.stringify(record));
    assert.equal((await readOmp(id)).read.state, "gone", "a stopped session without a transcript must allow owner-requested fresh review");
    await assert.rejects(recoverOmp(record.key, 1, id), /no persisted transcript/, "missing transcripts still prohibit resuming the original session");
  } finally { ompRuntime.root = originalRoot; }
  console.log("OMP RPC correlation, uncertain delivery, process exit and portable reporting schema regressions passed");
} finally {
  await rpc.close();
  rmSync(root, { recursive: true, force: true });
  await db.$client.end();
}
