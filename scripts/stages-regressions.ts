import "./test-guard";
import assert from "node:assert/strict";
import { STAGES, type Stage } from "@factory/core/events";
import { canTransition, causeOf, decideStage, RUNNER_CAUSES, runnerEventId, type Cause } from "@factory/core/stages";
import { isStopped } from "@factory/runner/binding";

const CAUSES: Cause[] = ["report", ...RUNNER_CAUSES];
const allowed: [Stage, Stage, Cause][] = [
  ["queued", "building", "inferred"],
  ["building", "reviewing", "inferred"],
  ["reviewing", "building", "changes"],
  ["reviewing", "ready", "inferred"],
  ["building", "ready", "inferred"],
  ["ready", "building", "conflict"],
  ["ready", "building", "changes"],
  ["ready", "done", "merged"],
  ["building", "failed", "stop"],
  ["ready", "failed", "closed"],
  ["failed", "queued", "reclaim"],
];
for (const [from, to, cause] of allowed) {
  assert.equal(canTransition(from, to, cause), true, `${from} -> ${to} (${cause}) is allowed`);
}

const forbidden: [Stage, Stage, Cause][] = [
  ...STAGES.flatMap((from) => STAGES.map((to): [Stage, Stage, Cause] => [from, to, "report"])),
  ...STAGES.flatMap((to) => CAUSES.map((cause): [Stage, Stage, Cause] => ["done", to, cause])),
  ["building", "failed", "watchdog"],
  ["ready", "reviewing", "conflict"],
  ["failed", "ready", "inferred"],
];
for (const [from, to, cause] of forbidden) {
  assert.equal(canTransition(from, to, cause), false, `${from} -> ${to} (${cause}) is forbidden`);
}

for (const cause of RUNNER_CAUSES) {
  assert.equal(causeOf(runnerEventId(cause, "abc", 2, "x")), cause, `a ${cause} event id names its cause`);
}
assert.equal(causeOf("6e4900b4c22c2f3554c3955c41923e5ebe07a3ff"), "report", "a hook's hashed event id is a thread report");
assert.equal(causeOf("regress-1-7"), "report");
const stopped = { stage: "failed" as const, stop_event_id: runnerEventId("stop", "x", 1, "e"), execution_id: null, stop_sent_to: null };
assert.equal(isStopped(stopped), true, "runner/binding.ts reads a stop from the prefix runnerEventId writes");

const row = { key: "FAC-7", stage: "building" as Stage, stage_at: new Date(1_000), attempt: 2, stage_event_id: "e-1" };
const move = (over: Partial<Parameters<typeof decideStage>[1]>) => decideStage(row, { stage: "reviewing", at: new Date(2_000), eventId: "inferred:e-2", ...over });
assert.deepEqual(move({}), { outcome: "apply", cause: "inferred" });
assert.deepEqual(move({ branch: "factory/FAC-7-a2" }), { outcome: "apply", cause: "inferred" });
assert.deepEqual(move({ eventId: "e-1" }), { outcome: "skip", cause: "report", reason: "already applied" });
assert.deepEqual(move({ at: new Date(500) }), { outcome: "skip", cause: "inferred", reason: "stale" });
assert.deepEqual(move({ branch: "factory/FAC-7" }), { outcome: "skip", cause: "inferred", reason: "earlier attempt" });
assert.equal(move({ eventId: "builder-report" }).outcome, "refuse");

console.log(`stages regressions passed: ${allowed.length} allowed and ${forbidden.length} forbidden transitions`);
