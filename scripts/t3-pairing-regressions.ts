import "./test-guard";
import assert from "node:assert/strict";
import { eq, inArray, like } from "drizzle-orm";

const OWNER = "owner@example.com";
process.env.FACTORY_OWNER_EMAILS = OWNER;

const { db } = await import("@factory/storage/client");
const { intents, jobs } = await import("@factory/storage/schema");
const { internalJob } = await import("./fixtures");
const { jobId } = await import("@factory/core/sources/shapes");
const { TEST_MACHINE_ID } = await import("@factory/core/config");
const { localHost } = await import("@factory/core/host");
const { requestPairing, takePairing } = await import("@factory/core/t3-pairing");
const { openT3 } = await import("@factory/runner/pairing");
const { expirePairings, INTENT_ATTEMPTS, INTENT_ROUTES, loggable } = await import("@factory/runner/intents");


const stamp = Date.now() % 1_000_000;
const TOKEN = "pairing-secret-token";
const owner = { email: OWNER, emailVerified: true };
const deps = (user: typeof owner | null = owner, now?: () => Date) => ({ db, user: async () => user, ...(now && { now }) });

const pairingCalls: string[][] = [];
let pairingReply: { code?: number; stdout?: string; stderr?: string } | undefined;
localHost.run = async (_command, argv) => {
  pairingCalls.push(argv);
  return {
    stdout: pairingReply?.stdout ?? JSON.stringify({ expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), pairUrl: `http://localhost:3773/pair#token=${TOKEN}` }),
    stderr: pairingReply?.stderr ?? "",
  };
};

const ids: ReturnType<typeof jobId>[] = [];
async function insert(name: string, over: Partial<typeof jobs.$inferInsert>) {
  const k = `PAIR${name}-${stamp}`;
  const id = jobId("internal", `pairing-regress-${k}`);
  ids.push(id);
  await db.insert(jobs).values(internalJob(`pairing-regress-${k}`, k, { machine_id: TEST_MACHINE_ID, stage: "implementing", ...over }));
  return id;
}

/** Stores the runner's answer the way runIntent does. */
async function answer(intentId: string, result: unknown, handledAt = new Date()) {
  await db.update(intents).set({ handled_at: handledAt, attempts: 1, result: JSON.stringify(result) }).where(eq(intents.id, intentId));
}

const stored = async (intentId: string) => (await db.select().from(intents).where(eq(intents.id, intentId)))[0]!.result ?? "";

try {
  assert.equal(INTENT_ROUTES.open_t3, "owner", "only the job's runner can reach its thread");
  assert.equal(INTENT_ATTEMPTS.open_t3, 1, "a failed pairing is not retried for a day");

  const RUN = await insert("RUN", { t3_thread_id: "thread-RUN" });
  const minted = await openT3(RUN);
  assert.ok("pairUrl" in minted, JSON.stringify(minted));
  assert.equal(minted.pairUrl, `http://localhost:3773/pair#token=${TOKEN}`);
  const call = pairingCalls.at(-1)!;
  assert.deepEqual(call.slice(call.indexOf("--ttl"), call.indexOf("--ttl") + 2), ["--ttl", "15m"]);
  assert.ok(call.includes("--json"), "asks for JSON");

  // Logging never sees the link.
  const logged = JSON.stringify(loggable("open_t3", minted));
  assert.ok(!logged.includes(TOKEN) && !logged.includes("pairUrl"), logged);
  assert.deepEqual(loggable("claim", { claimed: 1 }), { claimed: 1 });

  const LOCAL = await insert("LOCAL", {});
  assert.deepEqual(await openT3(LOCAL), { refused: "This job has no running T3 thread." });
  const PENDING = await insert("PENDING", { t3_thread_id: "pending:launch" });
  assert.deepEqual(await openT3(PENDING), { refused: "This job has no running T3 thread." });
  assert.deepEqual(await requestPairing(deps(), PENDING), { ok: false, message: "This job has no running T3 thread." });

  // Output the CLI did not mean as JSON is never quoted back, since it may hold the token.
  pairingReply = { stdout: `Pairing token: ${TOKEN}` };
  await assert.rejects(openT3(RUN), (error: Error) => !error.message.includes(TOKEN) && /no pairing response/.test(error.message));
  pairingReply = undefined;

  assert.deepEqual(await requestPairing(deps(null), RUN), { ok: false, message: "Only the factory owner can open T3." });
  assert.equal((await requestPairing(deps(), LOCAL)).ok, false);
  const asked = await requestPairing(deps(), RUN);
  assert.ok(asked.ok);
  const [intent] = await db.select().from(intents).where(eq(intents.id, asked.intentId));
  assert.deepEqual([intent!.kind, intent!.job_id, intent!.handled_at], ["open_t3", RUN, null]);
  assert.deepEqual(await takePairing(deps(), asked.intentId), { status: "pending" });

  // Taken once: the stored link is replaced in the same read, and a second read gets nothing.
  await answer(asked.intentId, minted);
  assert.deepEqual(await takePairing(deps(null), asked.intentId), { status: "failed", message: "Only the factory owner can open T3." });
  assert.ok((await stored(asked.intentId)).includes(TOKEN), "a non-owner's read leaves the link for the owner");
  assert.deepEqual(await takePairing(deps(), asked.intentId), { status: "ready", pairUrl: minted.pairUrl, expiresAt: minted.expiresAt });
  assert.ok(!(await stored(asked.intentId)).includes(TOKEN), "the link is gone from the row once shown");
  assert.deepEqual(await takePairing(deps(), asked.intentId), { status: "failed", message: "This pairing link was already shown." });

  // A link read after its TTL is cleared, not shown.
  const late = await requestPairing(deps(), RUN);
  assert.ok(late.ok);
  await answer(late.intentId, minted);
  assert.deepEqual(await takePairing(deps(owner, () => new Date(Date.now() + 16 * 60_000)), late.intentId), { status: "failed", message: "This pairing link expired." });
  assert.ok(!(await stored(late.intentId)).includes(TOKEN));

  // A link the panel never took is cleared by the runner's timer once the token has expired.
  const unread = await requestPairing(deps(), RUN);
  const fresh = await requestPairing(deps(), RUN);
  assert.ok(unread.ok && fresh.ok);
  await answer(unread.intentId, minted, new Date(Date.now() - 16 * 60_000));
  await answer(fresh.intentId, minted);
  assert.ok((await expirePairings()) >= 1);
  assert.equal(await stored(unread.intentId), JSON.stringify({ cleared: "expired" }));
  assert.ok((await stored(fresh.intentId)).includes(TOKEN), "a link still within its TTL stays for the panel");

  // Refusals and errors reach the panel as messages.
  const refused = await requestPairing(deps(), RUN);
  assert.ok(refused.ok);
  await answer(refused.intentId, { refused: "T3 is unavailable." });
  assert.deepEqual(await takePairing(deps(), refused.intentId), { status: "failed", message: "T3 is unavailable." });
  const failed = await requestPairing(deps(), RUN);
  assert.ok(failed.ok);
  await answer(failed.intentId, { error: "Error: sandbox exec timed out" });
  assert.match((await takePairing(deps(), failed.intentId) as { message: string }).message, /could not make a pairing link: Error: sandbox exec timed out/);

  console.log("t3 pairing regressions passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.delete(intents).where(like(intents.id, "panel:open_t3:%"));
  await db.delete(jobs).where(inArray(jobs.id, ids));
  process.exit(process.exitCode ?? 0);
}
