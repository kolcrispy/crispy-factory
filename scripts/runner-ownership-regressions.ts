import "./test-guard";
import assert from "node:assert/strict";
import { db } from "@factory/storage/client";
import { acquireRunnerOwnership } from "@factory/runner/ownership";

let release: (() => Promise<void>) | undefined;
try {
  release = await acquireRunnerOwnership(db.$client, error => { throw error; });
  await assert.rejects(acquireRunnerOwnership(db.$client, error => { throw error; }), /Another runner already owns/);
  await release();
  release = await acquireRunnerOwnership(db.$client, error => { throw error; });
  await release();
  await release();
  console.log("Runner ownership rejects overlapping processes and permits clean restart");
} finally {
  await release?.();
  await db.$client.end();
}
