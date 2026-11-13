import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { intents, repoSettings } from "@factory/storage/schema";

const id = `cli-regression:${randomUUID()}`;
const requestId = randomUUID();
const repo = `regression/cli-${randomUUID()}`;
let registrationIntentId: string | undefined;
async function cli(input: object, wait?: string, resource = "requests", action = "show", extra: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, "apps/cli/src/index.ts", resource, action, "--actor", "local:cli-regression", "--input", JSON.stringify(input), ...(wait === undefined ? [] : ["--wait", wait])], {
    env: { ...process.env, ...extra },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  assert.equal(error, "", "request inspection must not emit secret-bearing diagnostics");
  return { code, value: JSON.parse(out) };
}
try {
  const registration = await cli({ requestId, repo }, undefined, "repositories", "add");
  assert.equal(registration.code, 0);
  assert.equal(registration.value.status, "queued", "offline registration stays inspectable without GitHub credentials");
  registrationIntentId = registration.value.intentId;
  assert.equal(typeof registrationIntentId, "string");
  assert.deepEqual(await cli({ requestId, repo }, undefined, "repositories", "add"), registration, "the CLI replays the durable registration request");
  await db.insert(intents).values({ id, kind: "claim", created_at: new Date() });
  const queued = await cli({ intentId: id });
  assert.equal(queued.code, 0);
  assert.equal(queued.value.status, "queued", "offline runner leaves accepted work inspectable");
  const timeout = await cli({ intentId: id }, "0");
  assert.equal(timeout.code, 2);
  assert.equal(timeout.value.status, "timeout");
  assert.equal((await db.select().from(intents).where(eq(intents.id, id)))[0]!.handled_at, null, "waiting timeout must not cancel accepted work");
  await db.update(intents).set({ handled_at: new Date(), result: JSON.stringify({ claimed: [] }) }).where(eq(intents.id, id));
  const done = await cli({ intentId: id });
  assert.equal(done.code, 0);
  assert.equal(done.value.status, "done");
  await db.update(intents).set({ result: JSON.stringify({ error: "" }) }).where(eq(intents.id, id));
  const emptyError = await cli({ intentId: id });
  assert.equal(emptyError.code, 1);
  assert.equal(emptyError.value.status, "failed", "failure envelope does not depend on error text truthiness");
  await db.update(intents).set({ result: JSON.stringify({ stop: { refused: "attempt changed" } }) }).where(eq(intents.id, id));
  const refused = await cli({ intentId: id });
  assert.equal(refused.code, 1);
  assert.equal(refused.value.status, "refused");
  process.env.CLI_REGRESSION_SECRET = "isolated-cli-secret-value";
  await db.update(intents).set({ result: JSON.stringify({ error: "isolated-cli-secret-value" }) }).where(eq(intents.id, id));
  const failed = await cli({ intentId: id });
  assert.equal(failed.code, 1);
  assert.equal(failed.value.result.error, "[redacted]", "CLI results redact known secret values");
  console.log("CLI offline, timeout, completion, refusal, and redaction regressions passed");
} finally {
  delete process.env.CLI_REGRESSION_SECRET;
  await db.delete(intents).where(eq(intents.id, id));
  if (registrationIntentId) await db.delete(intents).where(eq(intents.id, registrationIntentId));
  await db.delete(repoSettings).where(eq(repoSettings.repo, repo));
  await db.$client.end();
}
