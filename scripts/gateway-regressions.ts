import "./test-guard";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { serve } from "./serve";
import { db } from "@factory/storage/client";
import { eq } from "drizzle-orm";
import { events, runs } from "@factory/storage/schema";

const session = `gateway-${crypto.randomUUID()}`;

const secret = "isolated-gateway-signing-secret";
const saved = { signing: process.env.SLACK_SIGNING_SECRET, owner: process.env.SLACK_OWNER_USER_ID, ingest: process.env.FACTORY_INGEST_SECRET };
process.env.SLACK_SIGNING_SECRET = secret;
process.env.SLACK_OWNER_USER_ID = "UOWNER";
delete process.env.FACTORY_INGEST_SECRET;
const { default: handler } = await import("@factory/gateway/index");
const server = await serve(0, request => handler.fetch(request));
const url = `http://localhost:${server.port}`;
async function command(user: string, timestamp = Math.floor(Date.now() / 1000), signatureSecret = secret) {
  const body = new URLSearchParams({ command: "/factory", user_id: user, text: "help", trigger_id: "test-trigger", response_url: "https://example.invalid/response" }).toString();
  const signature = createHmac("sha256", signatureSecret).update(`v0:${timestamp}:${body}`).digest("hex");
  return fetch(`${url}/api/slack/commands`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": String(timestamp), "x-slack-signature": `v0=${signature}` }, body });
}
try {
  const accepted = await command("UOWNER");
  assert.equal(accepted.status, 200);
  assert.match((await accepted.json()).text, /opens the New job form/);
  const stranger = await command("USTRANGER");
  assert.equal(stranger.status, 200);
  assert.match((await stranger.json()).text, /Only the factory owner/);
  assert.equal((await command("UOWNER", Math.floor(Date.now() / 1000) - 600)).status, 401, "old signed traffic is rejected");
  assert.equal((await command("UOWNER", Math.floor(Date.now() / 1000), "wrong-secret")).status, 401);
  assert.equal((await fetch(`${url}/ingest`, { method: "POST", headers: { authorization: "Bearer undefined" }, body: "{}" })).status, 401, "unconfigured ingest fails closed");
  process.env.FACTORY_INGEST_SECRET = "isolated-ingest-secret";
  const event = { sessionId: session, eventId: `${session}-start`, kind: "session_start", at: Date.now(), cwd: "/tmp/gateway", branch: "test-gateway", transcriptPath: "/tmp/gateway.jsonl" };
  const send = () => fetch(`${url}/ingest`, { method: "POST", headers: { authorization: "Bearer isolated-ingest-secret", "content-type": "application/json" }, body: JSON.stringify([event]) });
  assert.equal((await send()).status, 200, "authenticated reports persist without a runner or dashboard");
  assert.equal((await send()).status, 200, "HTTP replay remains accepted");
  const persisted = await db.select().from(events).where(eq(events.event_id, event.eventId));
  assert.deepEqual(persisted.map(row => row.session_id), [session], "HTTP replay stores one event");
  console.log("Independent gateway signed HTTP and authorization regressions passed");
} finally {
  for (const [name, value] of [["SLACK_SIGNING_SECRET", saved.signing], ["SLACK_OWNER_USER_ID", saved.owner], ["FACTORY_INGEST_SECRET", saved.ingest]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
  await server.close();
  await db.delete(events).where(eq(events.session_id, session));
  await db.delete(runs).where(eq(runs.session_id, session));
  await db.$client.end();
}
