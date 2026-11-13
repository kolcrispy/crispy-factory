import "./test-guard";
import assert from "node:assert/strict";
import { launchEntries, MaybeStartedError, type LaunchEntry } from "@factory/runner/launch";
import { db } from "@factory/storage/client";

const entry: LaunchEntry = { key: "JOB-1", attempt: 1, repo: "test/repo", branch: "factory/JOB-1", threadTitle: "Repair", message: "Repair", harness: { provider: "codex", model: "test" }, base: "origin/main" };
try {
  const released: string[] = [];
  const deps = { claim: async () => true, start: async () => "thread-1", bind: async () => { throw new Error("database disconnected after thread started"); }, release: async (key: string) => { released.push(key); }, now: () => 1 };
  const binding = await launchEntries([entry], deps);
  assert.deepEqual(released, [], "a started thread retains its pending ownership when database binding fails");
  assert.equal(binding[0]!.retry, "after launch recovery");
  const ambiguous = await launchEntries([entry], { ...deps, start: async () => { throw new MaybeStartedError("start response lost"); } });
  assert.deepEqual(released, [], "an ambiguous start must not create a second thread on the next pass");
  assert.equal(ambiguous[0]!.retry, "after launch recovery");
  const refused = await launchEntries([entry], { ...deps, start: async () => { throw Object.assign(new Error("executable missing"), { code: "ENOENT" }); } });
  assert.deepEqual(released, [entry.key], "a definite pre-launch failure releases ownership");
  assert.equal(refused[0]!.retry, "next pass");
  console.log("Local launch binding failure, ambiguous start, and definite failure regressions passed");
} finally {
  await db.$client.end();
}
