import "./test-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { repoSettings } from "@factory/storage/schema";
import { prepareRepository, repositoryRuntime } from "@factory/runner/repository-registration";

const root = await mkdtemp(join(tmpdir(), "factory-register-"));
const repo = `test/${randomUUID()}`;
const previous = { ...repositoryRuntime };
let fail = true;
try {
  await db.insert(repoSettings).values({ repo, updated_by: "regression", updated_at: new Date() });
  repositoryRuntime.request = async () => ({ status: 200, json: { full_name: repo, default_branch: "trunk", archived: false, permissions: { push: true } } });
  repositoryRuntime.run = async (command, args) => {
    if (command === "gh") {
      await writeFile(join(args[3]!, "user.txt"), "keep");
      if (fail) throw new Error("clone disconnected");
    }
    return { stdout: args[0] === "remote" ? `ssh://git@github.com/${repo}.git` : "head", stderr: "" };
  };
  const detail = JSON.stringify({ repo, actor: "regression" });
  await assert.rejects(prepareRepository(detail, root), /clone disconnected/);
  assert.equal(existsSync(join(root, ...repo.split("/"))), false, "failed clone must not become the adopted checkout");
  assert.deepEqual(await readdir(join(root, "test")), [], "owned partial clone is removed");
  fail = false;
  const ready = await prepareRepository(detail, root);
  assert.equal(ready.status, "ready");
  assert.equal(await readFile(join(ready.checkout, "user.txt"), "utf8"), "keep");
  await prepareRepository(JSON.stringify({ repo, actor: "regression", checkout: ready.checkout }), root);
  assert.equal(await readFile(join(ready.checkout, "user.txt"), "utf8"), "keep", "adoption must preserve local files");
  const [row] = await db.select().from(repoSettings).where(eq(repoSettings.repo, repo));
  assert.deepEqual([row!.registration_status, row!.default_branch], ["ready", "trunk"]);
  console.log("Repository partial-clone recovery, SSH origin, default branch, and non-destructive adoption passed");
} finally {
  Object.assign(repositoryRuntime, previous);
  await db.delete(repoSettings).where(eq(repoSettings.repo, repo));
  await rm(root, { recursive: true, force: true });
  await db.$client.end();
}
