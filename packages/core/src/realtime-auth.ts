import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { realtimeClients, realtimePairings } from "@factory/storage/schema";

const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");
export async function createRealtimePairing(label: string) {
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  await db.insert(realtimePairings).values({ digest: digest(code), label, expires_at: expiresAt });
  return { code, expiresAt };
}
export async function redeemRealtimePairing(code: string) {
  return db.transaction(async tx => {
    const [pairing] = await tx.delete(realtimePairings).where(and(eq(realtimePairings.digest, digest(code)), gt(realtimePairings.expires_at, new Date()))).returning();
    if (!pairing) return null;
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    await tx.insert(realtimeClients).values({ id, digest: digest(token), label: pairing.label, created_at: new Date() });
    return { id, token };
  });
}
export async function realtimeClient(token: string) {
  if (!token || token.length > 128) return null;
  return (await db.select({ id: realtimeClients.id }).from(realtimeClients).where(eq(realtimeClients.digest, digest(token))))[0]?.id ?? null;
}
export async function listRealtimeClients() {
  return db.select({ id: realtimeClients.id, label: realtimeClients.label, createdAt: realtimeClients.created_at }).from(realtimeClients);
}
export async function revokeRealtimeClient(id: string) {
  await db.delete(realtimeClients).where(eq(realtimeClients.id, id));
}
