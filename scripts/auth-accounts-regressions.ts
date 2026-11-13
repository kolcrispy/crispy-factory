import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { ownerAccounts, ownerSessions } from "@factory/storage/auth-schema";
import { loginOwner, logoutOwner, manageOwner, sessionOwner } from "@factory/core/auth/accounts";
import { isOwner } from "@factory/core/auth/owner";

const email = `${randomUUID()}@example.com`;
try {
  await manageOwner("create", email, "passphrase-123");
  const [account] = await db.select().from(ownerAccounts).where(eq(ownerAccounts.email, email));
  assert.ok(account.password_hash.startsWith("$argon2id$"));
  assert.equal(await loginOwner(email, "wrong", "isolated"), null);
  const first = await loginOwner(email, "passphrase-123", "isolated");
  assert.ok(first);
  assert.ok(isOwner(await sessionOwner(first.token)));
  const second = await loginOwner(email, "passphrase-123", "isolated");
  assert.ok(second);
  await logoutOwner(first.token);
  assert.equal(await sessionOwner(first.token), null);
  assert.ok(await sessionOwner(second.token));
  await manageOwner("reset", email, "replacement-123");
  assert.equal(await sessionOwner(second.token), null);
  assert.equal(await loginOwner(email, "passphrase-123", "isolated"), null);
  const third = await loginOwner(email, "replacement-123", "isolated");
  assert.ok(third);
  const tokenHash = createHash("sha256").update(third.token).digest("hex");
  const idleAt = new Date(Date.now() - 3600000);
  await db.update(ownerSessions).set({ last_active_at: idleAt }).where(eq(ownerSessions.token_hash, tokenHash));
  assert.ok(await sessionOwner(third.token, false));
  const [passive] = await db.select().from(ownerSessions).where(eq(ownerSessions.token_hash, tokenHash));
  assert.equal(passive.last_active_at.getTime(), idleAt.getTime(), "background polling must not extend idle sessions");
  await db.update(ownerSessions).set({ last_active_at: new Date(Date.now() - 25 * 3600000) }).where(eq(ownerSessions.token_hash, createHash("sha256").update(third.token).digest("hex")));
  assert.equal(await sessionOwner(third.token), null);
  const fourth = await loginOwner(email, "replacement-123", "isolated");
  assert.ok(fourth);
  for (let i = 0; i < 11; i++) await loginOwner(email, "wrong", "throttle-test");
  assert.equal(await loginOwner(email, "replacement-123", "throttle-test"), null, "valid credentials cannot bypass a throttled identity");
  await manageOwner("disable", email);
  assert.equal(await sessionOwner(fourth.token), null);
  assert.equal(await loginOwner(email, "replacement-123", "isolated"), null);
  console.log("Owner password, sessions, reset, expiry and disable regressions passed");
} finally {
  await db.delete(ownerAccounts).where(eq(ownerAccounts.email, email));
  await db.$client.end();
}
