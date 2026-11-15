import assert from "node:assert/strict";
import { generateDrizzleJson } from "drizzle-kit/api";
import * as schema from "../packages/storage/src/schema";

export async function checkSnapshot() {
  const journal = await Bun.file("drizzle/meta/_journal.json").json();
  const latest = journal.entries.at(-1);
  const snapshot = await Bun.file(`drizzle/meta/${String(latest.idx).padStart(4, "0")}_snapshot.json`).json();
  const current = JSON.parse(JSON.stringify(generateDrizzleJson(schema)));
  for (const key of ["tables", "enums", "schemas", "sequences", "roles", "policies", "views"] as const) {
    assert.deepEqual(snapshot[key], current[key], `Latest migration snapshot differs from schema: ${key}`);
  }
  console.log("Latest migration snapshot matches schema");
}
if (import.meta.main) await checkSnapshot();
