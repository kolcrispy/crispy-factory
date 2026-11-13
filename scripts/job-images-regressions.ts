import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { jobImages } from "@factory/storage/schema";
import { localizeJobImages } from "@factory/runner/job-images";

const id = randomUUID();
const root = await mkdtemp(join(tmpdir(), "factory-input-"));
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
try {
  await db.insert(jobImages).values({ id, filename: "layout.png", content_type: "image/png", bytes, uploaded_by: "regression" });
  const result = await localizeJobImages(`Follow ![layout](/api/jobs/images/${id})`, root, "JOB-1", 2);
  const expected = join(root, ".factory-inputs", "JOB-1", "2", `${id}.png`);
  assert.equal(result, `Follow ![layout](${expected.replaceAll("\\", "/")})`);
  assert.deepEqual(await readFile(expected), bytes, "agent gets the uploaded bytes without dashboard credentials");
  await assert.rejects(localizeJobImages(`/api/jobs/images/${randomUUID()}`, root, "JOB-1", 2), /missing/);
  console.log("Shared job image persistence and local agent input delivery passed");
} finally {
  await db.delete(jobImages).where(eq(jobImages.id, id));
  await rm(root, { recursive: true, force: true });
  await db.$client.end();
}
