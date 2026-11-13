import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { manageOwner, loginOwner } from "@factory/core/auth/accounts";
import { proxy } from "../apps/dashboard/proxy";
import { db } from "@factory/storage/client";
import { ownerAccounts } from "@factory/storage/auth-schema";
import { eq } from "drizzle-orm";

process.env.FACTORY_DASHBOARD_URL = "http://localhost:3000";
const email = `${randomUUID()}@example.com`;
try {
  assert.equal((await proxy(new NextRequest("http://localhost:3000/"))).status, 307);
  assert.equal((await proxy(new NextRequest("http://localhost:3000/api/live/runs"))).status, 401);
  await manageOwner("create", email, "password-123");
  const session = await loginOwner(email, "password-123", "proxy-test");
  assert.ok(session);
  const headers = { cookie: `factory_owner_session=${session.token}` };
  assert.equal((await proxy(new NextRequest("http://localhost:3000/api/live/runs", { headers }))).status, 200);
  assert.equal((await proxy(new NextRequest("http://localhost:3000/api/jobs/images", { method: "POST", headers: { ...headers, origin: "https://evil.invalid" } }))).status, 403);
  await manageOwner("disable", email);
  assert.equal((await proxy(new NextRequest("http://localhost:3000/api/live/runs", { headers }))).status, 401);
  console.log("Proxy session and cross-origin denial regressions passed");
} finally {
  await db.delete(ownerAccounts).where(eq(ownerAccounts.email, email));
  await db.$client.end();
}
