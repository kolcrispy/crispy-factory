import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash as hashPassword, verify } from "@node-rs/argon2";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { ownerAccounts, ownerSessions, loginAttempts } from "@factory/storage/auth-schema";
import { trustedOperator } from "./owner";

const IDLE_MS = 24 * 60 * 60 * 1000;
const LIFE_MS = 7 * IDLE_MS;
const WINDOW_MS = 15 * 60 * 1000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (email: string) => email.trim().toLowerCase();

export async function manageOwner(action: "create" | "reset" | "disable", email: string, password?: string) {
  email = normalize(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid owner email is required.");
  if (action !== "disable" && (!password || [...password].length < 8 || password.length > 1024)) {
    throw new Error("Password must contain 8 to 1024 characters.");
  }
  const hash = action === "disable" ? undefined : await hashPassword(password!, { algorithm: 2, memoryCost: 19456, timeCost: 2 });
  return db.transaction(async tx => {
    if (action === "create") {
      await tx.insert(ownerAccounts).values({ id: randomUUID(), email, password_hash: hash! });
    } else {
      const [owner] = await tx.update(ownerAccounts).set(action === "disable" ? { active: false } : { password_hash: hash! })
        .where(eq(ownerAccounts.email, email)).returning({ id: ownerAccounts.id });
      if (!owner) throw new Error("Owner account not found.");
      await tx.delete(ownerSessions).where(eq(ownerSessions.owner_id, owner.id));
    }
    return { ok: true, email, action };
  });
}

// A valid dummy hash prevents unknown emails from skipping expensive password verification.
const dummyHash = hashPassword("unusable-" + randomBytes(32).toString("hex"), { algorithm: 2, memoryCost: 19456, timeCost: 2 });

export async function loginOwner(email: string, password: string, network: string) {
  email = normalize(email);
  if (email.length > 320 || password.length > 1024) return null;
  const now = new Date();
  const keys = ["email:" + digest(email), "network:" + digest(network)];
  const allowed = await db.transaction(async tx => {
    // Fixed lock order keeps simultaneous attempts from deadlocking.
    let ok = true;
    for (const key of keys.sort()) {
      const [attempt] = await tx.insert(loginAttempts).values({ key, count: 1, window_start: now })
        .onConflictDoUpdate({ target: loginAttempts.key, set: {
          count: sql`case when ${loginAttempts.window_start} <= ${now}::timestamptz - interval '15 minutes' then 1 else ${loginAttempts.count} + 1 end`,
          window_start: sql`case when ${loginAttempts.window_start} <= ${now}::timestamptz - interval '15 minutes' then ${now}::timestamptz else ${loginAttempts.window_start} end`,
        } }).returning();
      if (attempt.count > (key.startsWith("email:") ? 10 : 50)) ok = false;
    }
    return ok;
  });
  if (!allowed) return null;
  const [owner] = await db.select().from(ownerAccounts).where(eq(ownerAccounts.email, email));
  const valid = await verify(owner?.password_hash ?? await dummyHash, password);
  if (!valid || !owner?.active) return null;
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + LIFE_MS);
  // Recheck password and active state under a row lock: reset/disable cannot race a new session.
  return db.transaction(async tx => {
    const [current] = await tx.select().from(ownerAccounts).where(eq(ownerAccounts.id, owner.id)).for("update");
    if (!current?.active || current.password_hash !== owner.password_hash) return null;
    await tx.delete(ownerSessions).where(sql`${ownerSessions.expires_at} <= ${now} or ${ownerSessions.last_active_at} <= ${new Date(now.getTime() - IDLE_MS)}`);
    await tx.delete(loginAttempts).where(sql`${loginAttempts.window_start} < ${new Date(now.getTime() - WINDOW_MS)}`);
    await tx.insert(ownerSessions).values({ token_hash: digest(token), owner_id: owner.id, created_at: now, last_active_at: now, expires_at: expires });
    return { token, expires };
  });
}

export async function sessionOwner(token: string | undefined, touch = true) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = new Date();
  const condition = and(eq(ownerSessions.token_hash, digest(token)), eq(ownerSessions.owner_id, ownerAccounts.id),
    eq(ownerAccounts.active, true), gt(ownerSessions.expires_at, now), gt(ownerSessions.last_active_at, new Date(now.getTime() - IDLE_MS)));
  const [row] = touch
    ? await db.update(ownerSessions).set({ last_active_at: now }).from(ownerAccounts).where(condition).returning({ email: ownerAccounts.email })
    : await db.select({ email: ownerAccounts.email }).from(ownerSessions).innerJoin(ownerAccounts, eq(ownerAccounts.id, ownerSessions.owner_id)).where(condition);
  return row ? trustedOperator(row.email) : null;
}

export async function logoutOwner(token: string | undefined) {
  if (token) await db.delete(ownerSessions).where(eq(ownerSessions.token_hash, digest(token)));
}
