import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { intents, notificationSettings } from "@factory/storage/schema";

const id = `cli-regression:${randomUUID()}`;
const slackRequestId = randomUUID();
const slackIntentId = `panel:slack_test:${slackRequestId}`;
const [savedNotifications] = await db.select().from(notificationSettings).where(eq(notificationSettings.id, "factory"));
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
  const configured = await cli({ target: "off" }, undefined, "notifications", "save");
  assert.equal(configured.code, 0);
  assert.equal(configured.value.ok, true);
  const configuration = await cli({}, undefined, "notifications", "show");
  assert.equal(configuration.value.notifications.config.target, "off", "actual CLI persists configuration without a dashboard");
  assert.equal(configuration.value.notifications.updated_by, "local:cli-regression", "configuration records the trusted operator actor");
  const missingApp = join(tmpdir(), `missing-app-${randomUUID()}.json`);
  const addable = await cli({}, undefined, "repositories", "addable", { MARSHAL_FACTORY_GITHUB_APP: missingApp });
  assert.equal(addable.code, 1, "an absent GitHub App is an actionable refusal, not empty success");
  assert.match(addable.value.message, /no GitHub App at .*run bun scripts\/setup-github-app\.ts/);
  const notification = await cli({ requestId: slackRequestId }, undefined, "notifications", "test");
  assert.equal(notification.code, 0);
  assert.equal(notification.value.intentId, slackIntentId);
  assert.equal(notification.value.status, "queued", "offline notification acceptance remains inspectable");
  const notificationReplay = await cli({ requestId: slackRequestId }, undefined, "notifications", "test");
  assert.deepEqual(notificationReplay, notification, "actual CLI replays the same notification intent");
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
  await db.delete(intents).where(eq(intents.id, slackIntentId));
  await db.delete(notificationSettings).where(eq(notificationSettings.id, "factory"));
  if (savedNotifications) await db.insert(notificationSettings).values(savedNotifications);
  await db.$client.end();
}
