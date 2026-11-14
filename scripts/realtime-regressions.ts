import "./test-guard";
import assert from "node:assert/strict";
import { db } from "@factory/storage/client";
import { jobs, realtimeClients, realtimePairings } from "@factory/storage/schema";
import { eq } from "drizzle-orm";
import { createRealtimePairing, redeemRealtimePairing, revokeRealtimeClient } from "@factory/core/realtime-auth";
import { readRealtime } from "@factory/core/realtime-client";
import { startRealtimeServer } from "@factory/runner/realtime-server";
import { listenForWork } from "@factory/runner/wake";
import { internalJob } from "./fixtures";

const key = "realtime-regression";
const server = startRealtimeServer({ port: 0, origins: ["http://localhost:3000"] });
const url = `http://127.0.0.1:${server.server.port}`;
const close = await listenForWork(db.$client, server.refresh, error => { throw error; }, "factory_status");
const controller = new AbortController();
let clientId = "";
try {
  assert.equal((await fetch(`${url}/api/jobs`)).status, 401);
  assert.equal((await fetch(`${url}/api/pair`, { method: "POST", headers: { Origin: "https://foreign.example", "Content-Type": "application/json" }, body: "{}" })).status, 403);
  const pairing = await createRealtimePairing("SSE regression");
  const paired = await fetch(`${url}/api/pair`, { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ code: pairing.code }) });
  assert.equal(paired.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const credential = await paired.json() as { id: string; token: string };
  clientId = credential.id;
  assert.equal(await redeemRealtimePairing(pairing.code), null, "pairing code cannot be reused");
  let receive!: (value: unknown) => void;
  const next = () => {
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
    const timer = setTimeout(() => reject(new Error("SSE snapshot did not arrive")), 5000);
    receive = value => { clearTimeout(timer); resolve(value as Record<string, unknown>); };
    return promise;
  };
  let snapshot = next();
  const stream = readRealtime({ url, token: credential.token }, controller.signal, value => receive(value)).catch(() => {});
  await snapshot;
  snapshot = next();
  await db.insert(jobs).values(internalJob(key, key));
  const inserted = await snapshot;
  assert.ok((inserted.jobs as { key: string }[]).some(job => job.key === key), "committed job arrives over a real SSE connection without polling");
  snapshot = next();
  await db.update(jobs).set({ stage: "verifying" }).where(eq(jobs.key, key));
  const changed = await snapshot;
  assert.equal((changed.jobs as { key: string; stage: string }[]).find(job => job.key === key)?.stage, "verifying");
  controller.abort(); await stream;
  const reconnect = new AbortController();
  snapshot = next();
  const resumed = readRealtime({ url, token: credential.token }, reconnect.signal, value => receive(value)).catch(() => {});
  assert.equal((await snapshot).version, 1, "reconnect starts with a complete snapshot even at unchanged revision");
  await revokeRealtimeClient(clientId);
  const timeout = Promise.withResolvers<void>();
  const timer = setTimeout(() => timeout.reject(new Error("Revoked stream remained open")), 5000);
  try { await Promise.race([resumed, timeout.promise]); } finally { clearTimeout(timer); }
  assert.equal((await fetch(`${url}/api/jobs`, { headers: { Authorization: `Bearer ${credential.token}` } })).status, 401);
  reconnect.abort();
  console.log("Runner SSE pairing, committed updates, reconnect snapshots, origin checks and live revocation passed");
} finally {
  controller.abort();
  await close(); await server.stop();
  await db.delete(jobs).where(eq(jobs.key, key));
  if (clientId) await db.delete(realtimeClients).where(eq(realtimeClients.id, clientId));
  await db.delete(realtimePairings).where(eq(realtimePairings.label, "SSE regression"));
  await db.$client.end();
}
