import "./test-guard";
import assert from "node:assert/strict";
import { db } from "@factory/storage/client";
import { jobs } from "@factory/storage/schema";
import { eq } from "drizzle-orm";
import { listenForWork, wakeScheduler } from "@factory/runner/wake";
import { internalJob } from "./fixtures";

const queued: (() => Promise<void>)[] = [];
let passes = 0;
let release!: () => void;
const blocked = new Promise<void>(resolve => { release = resolve; });
const scheduler = wakeScheduler(run => queued.push(run), async () => {
  passes++;
  if (passes === 1) await blocked;
});
scheduler.wake();
scheduler.wake();
assert.equal(queued.length, 1, "a burst schedules one pass");
const first = queued.shift()!();
scheduler.wake();
assert.equal(queued.length, 0, "a signal cannot overlap a running pass");
release();
await first;
assert.equal(queued.length, 1, "a signal during execution gets a subsequent pass");
await queued.shift()!();
assert.equal(passes, 2);
scheduler.stop();
scheduler.wake();
assert.equal(queued.length, 0, "shutdown refuses new work");

const key = "immediate-wake-regression";
let signals = 0;
let received!: () => void;
const nextSignal = () => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Committed work did not wake runner")), 2000);
  received = () => { clearTimeout(timer); resolve(); };
});
const close = await listenForWork(db.$client, () => { signals++; received?.(); }, error => { throw error; });
try {
  let signal = nextSignal();
  await db.insert(jobs).values(internalJob(key, key));
  await signal;
  const before = signals;
  await assert.rejects(db.transaction(async tx => {
    await tx.update(jobs).set({ stage: "verifying" }).where(eq(jobs.key, key));
    throw new Error("rollback fixture");
  }), /rollback fixture/);
  await db.update(jobs).set({ updated_at: new Date() }).where(eq(jobs.key, key));
  // A committed notification acts as a barrier after the rollback and bookkeeping update.
  signal = nextSignal();
  await db.update(jobs).set({ stage: "verifying" }).where(eq(jobs.key, key));
  await signal;
  assert.equal(signals, before + 1, "only committed readiness changes wake the runner");
  console.log("Immediate committed wake, coalescing, in-flight signals and shutdown regressions passed");
} finally {
  await close();
  await db.delete(jobs).where(eq(jobs.key, key));
  await db.$client.end();
}
