import "./test-guard";
import assert from "node:assert/strict";
import { db } from "@factory/storage/client";
import { startReportServer } from "../apps/runner/src/report-server";
import { eq } from "drizzle-orm";
import { events, runs } from "@factory/storage/schema";
const session = `report-server:${crypto.randomUUID()}`;

assert.throws(() => startReportServer("http://0.0.0.0:3008/ingest", "x".repeat(32)), /loopback/);
assert.throws(() => startReportServer("http://127.0.0.1:3008/ingest", "short"), /32 characters/);
const server = startReportServer("http://127.0.0.1:0/ingest", "r".repeat(32));
try {
  const url = `http://127.0.0.1:${server.port}/ingest`;
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { authorization: `Bearer ${"r".repeat(32)}` }, body: "{}" })).status, 400);
  assert.equal((await fetch(new URL("/webhooks/github", url), { method: "POST" })).status, 404);
  assert.equal((await fetch(url)).status, 404);
  const event = { sessionId: session, eventId: `${session}:start`, kind: "session_start", at: Date.now(), cwd: "local-report-test", branch: "report-server-test" };
  const send = () => fetch(url, { method: "POST", headers: { authorization: `Bearer ${"r".repeat(32)}`, "content-type": "application/json" }, body: JSON.stringify([event]) });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  assert.equal((await db.select().from(events).where(eq(events.event_id, event.eventId))).length, 1, "HTTP replay persists exactly one report");
  console.log("Loopback binding, authentication, invalid reports, and removed public routes regressions passed");
} finally {
  await server.stop(true);
  await db.delete(events).where(eq(events.session_id, session));
  await db.delete(runs).where(eq(runs.session_id, session));
  await db.$client.end();
}
