import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { intents, repoSettings } from "@factory/storage/schema";
import { repositoryName, requestRepository } from "@factory/core/repository-registration";

const repo = `registration/${randomUUID()}`;
const requestId = randomUUID();
try {
  assert.equal(repositoryName("https://github.com/Owner/Repo.git"), "owner/repo");
  assert.throws(() => repositoryName("https://other.example/o/r"), /GitHub/);
  assert.throws(() => repositoryName("../repo"), /owner\/repo/);
  const input = { requestId, repo };
  const [first, replay] = await Promise.all([requestRepository(db, input, "operator:test"), requestRepository(db, input, "operator:test")]);
  assert.deepEqual(first, replay);
  const [row] = await db.select().from(repoSettings).where(eq(repoSettings.repo, repo));
  assert.equal(row!.registration_status, "pending", "offline registration must not report an unvalidated repository ready");
  const [intent] = await db.select().from(intents).where(eq(intents.id, first.intentId));
  assert.deepEqual(JSON.parse(intent!.detail!), { repo, actor: "operator:test" });
  assert.equal(intent!.handled_at, null);
  await assert.rejects(requestRepository(db, { ...input, repo: "other/repository" }, "operator:test"), /another repository/);
  console.log("Repository registration normalization, offline pending state, replay, and conflicting identity regressions passed");
} finally {
  await db.delete(intents).where(eq(intents.id, `repository:${requestId}`));
  await db.delete(repoSettings).where(eq(repoSettings.repo, repo));
  await db.$client.end();
}
