import "./test-guard";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray, like, or } from "drizzle-orm";
import type { FactoryEvent } from "@factory/core/events";
import { serve } from "./serve";

const { db } = await import("@factory/storage/client");
const { events, jobs, runs } = await import("@factory/storage/schema");
const { internalJob } = await import("./fixtures");
const { jobId } = await import("@factory/core/sources/shapes");
const { TEST_MACHINE_ID } = await import("@factory/core/config");
const { ingestBodySchema } = await import("@factory/core/events");
const { ingest } = await import("@factory/core/ingest");
const { appendEvent, flushOutbox, localFs, outboxDir, rejectedDir } = await import("@factory/core/outbox");
const { flushLocalOutbox, outboxClient } = await import("@factory/runner/outbox");


const stamp = Date.now() % 1_000_000;
const key = (name: string) => `OB${name}-${stamp}`;
const keys: string[] = [];
const dir = mkdtempSync(join(tmpdir(), "outbox-regress-"));
const row = async (k: string) => (await db.select().from(jobs).where(eq(jobs.key, k)))[0]!;
const hourAgo = new Date(Date.now() - 3_600_000);
const pending = (state: string) => (existsSync(outboxDir(state)) ? readdirSync(outboxDir(state)).filter((n) => n.endsWith(".json")).sort() : []);

async function insert(name: string, over: Partial<typeof jobs.$inferInsert>) {
  const k = key(name);
  keys.push(k);
  await db.insert(jobs).values(internalJob(`outbox-regress-${k}`, k, { machine_id: TEST_MACHINE_ID, stage: "building", provider: "omp", execution_id: `omp:${k}:1`, updated_at: hourAgo, ...over }));
  return k;
}

const stageEvent = (k: string, eventId: string, over: Record<string, unknown> = {}) =>
  ({ eventId, sessionId: `mcp:factory/${k}`, at: Date.now(), kind: "builder_report", action: "progress", summary: "Building it.", jobKey: k, branch: `factory/${k}`, ...over }) as FactoryEvent;

// A local stand-in for the deployed ingest function: same auth, same body schema, same projection.
const SECRET = "test-secret";
const received: string[][] = [];
const server = await serve(0, async (request) => {
  if (request.headers.get("authorization") !== `Bearer ${SECRET}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = ingestBodySchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  received.push(parsed.data.map((e) => e.eventId));
  return Response.json(await ingest(db, parsed.data));
});
const configPath = join(dir, "config.json");
writeFileSync(configPath, JSON.stringify({ ingestUrl: `http://localhost:${server.port}/ingest`, secret: SECRET }));

try {
  // The outbox on its own: ordering, failure, refusal and the cap.
  {
    const unit = join(dir, "unit");
    const sent: string[][] = [];
    let answer: "delivered" | "failed" = "failed";
    const send = async (batch: FactoryEvent[]) => {
      sent.push(batch.map((e) => e.eventId));
      // Every event of the batch is on disk before the POST.
      assert.equal(pending(unit).length >= batch.length, true, "appended before sent");
      if (batch.some((e) => e.eventId === "bad")) return { kind: "rejected" as const, reason: "ingest answered 400" };
      return answer === "delivered" ? { kind: "delivered" as const, spend: { "factory/X-1": 1 } } : { kind: "failed" as const, reason: "ingest answered 503" };
    };
    for (const id of ["e1", "e2", "e3"]) appendEvent(unit, stageEvent("X-1", id));
    const failed = await flushOutbox(localFs, unit, send, { budgetMs: 5_000 });
    assert.deepEqual([failed.delivered, failed.left, failed.error], [0, 3, "ingest answered 503"], "a failed POST keeps every event queued");
    assert.equal(pending(unit).length, 3);
    answer = "delivered";
    appendEvent(unit, stageEvent("X-1", "bad"));
    appendEvent(unit, stageEvent("X-1", "e5"));
    const flushed = await flushOutbox(localFs, unit, send, { budgetMs: 5_000 });
    assert.deepEqual(sent[1], ["e1", "e2", "e3", "bad", "e5"], "oldest first, in append order");
    assert.deepEqual([flushed.delivered, flushed.rejected, flushed.left], [4, ["bad"], 0], "a refused batch is retried one by one; only the refused event is set aside");
    assert.deepEqual(flushed.spend, { "factory/X-1": 1 });
    assert.equal(pending(unit).length, 0, "delivered events leave the outbox");
    assert.equal(readdirSync(rejectedDir(unit)).length, 1, "the refused one waits in outbox-rejected");
    const empty = await flushOutbox(localFs, unit, send, { budgetMs: 0 });
    assert.deepEqual([empty.delivered, empty.left], [0, 0]);

    // A refused event that cannot be set aside stays queued; the events after it still go.
    const jammed = join(dir, "jammed");
    for (const id of ["bad", "j2", "j3"]) appendEvent(jammed, stageEvent("X-1", id));
    const noRejectedDir = { ...localFs, writeFile: async (path: string, text: string) => (path.startsWith(rejectedDir(jammed)) ? Promise.reject(new Error("no such directory")) : localFs.writeFile(path, text)) };
    const sendJammed = async (batch: FactoryEvent[]) =>
      batch.some((e) => e.eventId === "bad") ? { kind: "rejected" as const, reason: "ingest answered 400" } : { kind: "delivered" as const, spend: {} };
    const past = await flushOutbox(noRejectedDir, jammed, sendJammed, { budgetMs: 5_000 });
    assert.deepEqual([past.delivered, past.rejected, past.stuck, past.left, past.error], [2, [], ["bad"], 1, undefined], "the flush goes on past an event it cannot set aside");
    assert.deepEqual(pending(jammed).map((n) => (JSON.parse(readFileSync(join(outboxDir(jammed), n), "utf8")) as FactoryEvent).eventId), ["bad"], "which stays queued for the next flush");

    const capped = join(dir, "capped");
    const warnings: string[] = [];
    for (let i = 1; i <= 5; i++) appendEvent(capped, stageEvent("X-1", `c${i}`), { highWater: 2, hardCap: 3, warn: (m) => void warnings.push(m) });
    assert.equal(pending(capped).length, 3, "the hard cap holds");
    const kept = pending(capped).map((n) => (JSON.parse(readFileSync(join(outboxDir(capped), n), "utf8")) as FactoryEvent).eventId);
    assert.deepEqual(kept, ["c3", "c4", "c5"], "the oldest go first");
    assert.ok(warnings.some((w) => /undelivered events/.test(w)), "past the high-water mark every append warns");
    assert.ok(warnings.some((w) => /dropped 1 undelivered/.test(w)), "and a drop is never silent");
    const droppedLog = readFileSync(join(capped, "outbox-dropped.log"), "utf8");
    assert.ok(/builder_report c1/.test(droppedLog) && /builder_report c2/.test(droppedLog), "each dropped event is logged by id and kind");
  }


  // Runner reconciliation delivers durable local reports without sandbox lifecycle dependencies.
  const runnerState = join(dir, "runner-state");
  const priorState = process.env.FACTORY_STATE_DIR;
  process.env.FACTORY_STATE_DIR = runnerState;
  const realSend = outboxClient.send;
  try {
    const LOCAL = await insert("LOCAL", {});
    const queued = stageEvent(LOCAL, `abc${stamp}runner`);
    await db.update(jobs).set({ session_id: queued.sessionId }).where(eq(jobs.key, LOCAL));
    appendEvent(runnerState, queued);
    outboxClient.send = async () => ({ kind: "failed", reason: "loopback unavailable" });
    const offline = await flushLocalOutbox();
    assert.equal(offline?.left, 1, "an unavailable report endpoint preserves the durable event");
    assert.equal((await row(LOCAL)).stage_summary, null);
    outboxClient.send = async (batch) => ({ kind: "delivered", spend: (await ingest(db, batch)).spend });
    const delivered = await flushLocalOutbox();
    assert.equal(delivered?.delivered, 1);
    assert.equal((await row(LOCAL)).stage_summary, "Building it.", "the next reconciliation delivers the report");
    assert.deepEqual(pending(runnerState), []);
    assert.equal((await flushLocalOutbox())?.delivered, 0, "acknowledged reports are never sent again");
  } finally {
    outboxClient.send = realSend;
    if (priorState === undefined) delete process.env.FACTORY_STATE_DIR;
    else process.env.FACTORY_STATE_DIR = priorState;
  }

  console.log("outbox regressions passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await server.close();
  await db.delete(events).where(or(inArray(events.job_key, keys), like(events.session_id, `mcp:factory/OB%-${stamp}`), like(events.session_id, `claude-OB%-${stamp}`)));
  await db.delete(runs).where(or(inArray(runs.job_key, keys), like(runs.session_id, `mcp:factory/OB%-${stamp}`)));
  await db.delete(jobs).where(like(jobs.id, `${jobId("internal", "outbox-regress-")}%`));
  process.exit(process.exitCode ?? 0);
}
