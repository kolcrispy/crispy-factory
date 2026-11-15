import "./test-guard";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { events, jobs, repoSettings, runs } from "@factory/storage/schema";
import { hosts, localHost } from "@factory/core/host";
import { eventSchema } from "@factory/core/events";
import { ingest } from "@factory/core/ingest";
import { TEST_MACHINE_ID } from "@factory/core/config";
import { github } from "@factory/integrations/github/pulls";
import { config, ingestClient, threads } from "@factory/runner/ops";
import { inferUntracked } from "@factory/runner/untracked";
import { internalJob } from "./fixtures";

const stamp = crypto.randomUUID();
const repo = `test/publication-${stamp}`;
const keys: string[] = [];
const sha = "a".repeat(40);
const old = new Date(Date.now() - 3_600_000);
const row = async (key: string) => (await db.select().from(jobs).where(eq(jobs.key, key)))[0]!;
let head = sha;
let dirty = false;
let publications = 0;
let pushes = 0;
let onPush: (() => Promise<void>) | undefined;
const bodies: string[] = [];
hosts.forJob = () => ({ ...localHost, async run(_command, args) {
  const operation = args[2];
  if (operation === "push") { pushes++; await onPush?.(); }
  return { stdout: operation === "rev-parse" ? head : operation === "ls-remote" ? `${sha}\trefs/heads/factory/test` : operation === "status" && dirty ? " M changed.ts" : "", stderr: "" };
} });
threads.read = async () => ({ state: "stopped", status: "completed", lastMessage: "Finished", checkout: "builder" });
github.createPull = async (_repo, input) => {
  publications++;
  bodies.push(input.body);
  return { url: `https://github.com/${repo}/pull/${publications}` };
};
ingestClient.post = async event => ingest(db, [eventSchema.parse(event)]);
async function insert(name: string, handoff = true, overrides: Partial<typeof jobs.$inferInsert> = {}) {
  const key = `UT-${name}-${stamp}`;
  keys.push(key);
  await db.insert(jobs).values(internalJob(key, key, {
    repo, machine_id: TEST_MACHINE_ID, stage: "building", stage_at: old, updated_at: old,
    t3_thread_id: `thread-${key}`, session_id: `session-${key}`,
    source_state: { actor: "owner", issueUrl: `https://github.com/${repo}/issues/1` },
    builder_handoff: handoff ? { eventId: `handoff-${key}`, at: old.getTime(), attempt: 1, sha, evidenceEventId: `evidence-${key}`, summary: "Verified work" } : null,
    evidence: { sha, attempt: 1, clean: true, checks: [], source: "none", producer: "agent", at: old.toISOString() },
    ...overrides,
  }));
  return key;
}
try {
  await db.insert(repoSettings).values({ repo, checkout_path: "repository", default_branch: "main", updated_at: new Date(), updated_by: "regression" });
  const missing = await insert("missing", false);
  await inferUntracked({ only: [missing] });
  assert.equal((await row(missing)).stage, "building");
  assert.match((await row(missing)).attention!.reason, /without a verified handoff/);
  assert.equal(publications, 0, "exit and prose do not authorize publication");
  const fresh = await insert("fresh", false, { updated_at: new Date() });
  await inferUntracked({ only: [fresh] });
  assert.equal((await row(fresh)).attention, null, "allow report delivery grace");
  const valid = await insert("valid");
  await inferUntracked({ only: [valid] });
  assert.equal((await row(valid)).stage, "ready");
  assert.match((await row(valid)).pr_url!, /\/pull\/1$/);
  assert.ok(bodies[0]!.includes(`Closes https://github.com/${repo}/issues/1`));
  await inferUntracked({ only: [valid] });
  assert.equal(publications, 1, "published attempts are not published again");
  head = "b".repeat(40);
  const changed = await insert("changed");
  await inferUntracked({ only: [changed] });
  assert.equal((await row(changed)).stage, "building");
  assert.match((await row(changed)).attention!.reason, /revision changed/);
  head = sha;
  dirty = true;
  const unclean = await insert("dirty");
  await inferUntracked({ only: [unclean] });
  assert.match((await row(unclean)).attention!.reason, /dirty/);
  dirty = false;
  const stale = await insert("stale");
  onPush = async () => { await db.update(jobs).set({ attempt: 2, builder_handoff: null }).where(eq(jobs.key, stale)); };
  await inferUntracked({ only: [stale] });
  assert.equal((await row(stale)).stage, "building");
  assert.equal(publications, 1, "attempt changed during push cannot publish a PR");
  assert.equal(pushes, 2, "invalid revisions and dirty work never reach push");
  console.log("explicit handoff publication regressions passed");
} finally {
  if (keys.length) {
    await db.delete(events).where(inArray(events.job_key, keys));
    await db.delete(runs).where(inArray(runs.job_key, keys));
    await db.delete(jobs).where(inArray(jobs.key, keys));
  }
  await db.delete(repoSettings).where(eq(repoSettings.repo, repo));
}
