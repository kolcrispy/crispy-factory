import "./test-guard";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JobHost } from "@factory/core/host";

const { factoryPlaybook, REPO_PLAYBOOK, withPlaybook } = await import("@factory/core/playbook");
const { conflictMessage } = await import("@factory/core/conflicts");
const { resumeMessage } = await import("@factory/core/resume");
const { nudgeMessage } = await import("@factory/core/watchdog");

const root = resolve(import.meta.dirname, "..");

// Where the playbook is: the runner's checkout.
assert.equal(factoryPlaybook(), join(root, "playbooks/factory.md"));
assert.ok(existsSync(factoryPlaybook()), "the local path is a file the runner's thread can open");

// The launch message names the host's path, and a repo copy only adds notes.
const calls: string[][] = [];
const host = (hasCopy: boolean): JobHost =>
  ({
    t3: "t3",
    run: async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      if (!hasCopy) throw Object.assign(new Error("exit 128"), { code: 128 });
      return { stdout: "", stderr: "" };
    },
  }) as unknown as JobHost;
{
  const path = factoryPlaybook();
  calls.length = 0;
  const bare = await withPlaybook("Work FAC-1: Title", host(false), "/work/repo");
  assert.ok(bare.startsWith("Work FAC-1: Title\n\n## Factory playbook\n"), `the section follows the message`);
  assert.ok(bare.includes(`The factory playbook is ${path}.`), `names ${path}`);
  assert.ok(!bare.includes(REPO_PLAYBOOK), `a repo without a copy hears nothing about one`);
  assert.deepEqual(calls, [["git", "-C", "/work/repo", "cat-file", "-e", `origin/main:${REPO_PLAYBOOK}`]], `the copy is looked up on main in the job's checkout`);
  const withCopy = await withPlaybook("Work FAC-1: Title", host(true), "/work/repo");
  assert.ok(withCopy.includes(`This repository also has ${REPO_PLAYBOOK}. The factory playbook at ${path} is authoritative`), `the factory playbook wins over a repo copy`);
  assert.ok(withCopy.includes("only for notes specific to this repository"));
}

// Follow-ups name the same path the launch did.
for (const path of [factoryPlaybook()]) {
  for (const [name, text] of [
    ["conflict", conflictMessage("FAC-1", "https://github.com/o/r/pull/1", path)],
    ["resume", resumeMessage("FAC-1", "Which one?", "The first.", path)],
    ["nudge", nudgeMessage("FAC-1", "implementing", 30, path)],
  ] as const) {
    assert.ok(text.includes(`factory playbook (${path})`), `${name} names ${path}`);
    assert.ok(!text.includes(REPO_PLAYBOOK), `${name} does not point at a repo copy`);
  }
}


// What the playbook points at still resolves from outside the repo.
const playbook = readFileSync(join(root, "playbooks/factory.md"), "utf8");
assert.match(playbook, /^---\nextends: bug-fix, feature, opening-a-pr, babysit\n/, "it extends PStack's bundled playbooks");
assert.ok(playbook.includes("report_stage") && playbook.includes("verify command"), "it tells the agent to report stages and run the named verification");
assert.ok(!playbook.includes(REPO_PLAYBOOK), "it never names a repo copy as its own location");

console.log("playbook regressions passed");
process.exit(0);
