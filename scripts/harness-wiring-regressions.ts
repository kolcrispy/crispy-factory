import "./test-guard";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wireHarnessReporting } from "@factory/runner/harness-wiring";

const home = mkdtempSync(join(tmpdir(), "factory-wiring-"));
const root = join(home, "factory", "packages", "reporting", "src");
const claude = join(home, ".claude", "settings.json");
const codex = join(home, ".codex", "config.toml");
try {
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(claude, JSON.stringify({ permissions: { allow: ["Bash(git status)"] }, model: "sonnet" }));
  writeFileSync(codex, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "other"\n');

  const first = wireHarnessReporting(root, home);
  assert.deepEqual(first.failed, []);
  assert.deepEqual(first.changed.sort(), [claude, codex].sort(), "the first pass writes both files");
  const settings = JSON.parse(readFileSync(claude, "utf8"));
  assert.equal(settings.model, "sonnet", "unrelated Claude settings survive");
  assert.deepEqual(settings.permissions.allow, ["Bash(git status)", "mcp__factory-report__report_stage"], "the report tool is allowed");
  const command = settings.hooks.PostToolUse[0].hooks[0].command;
  assert.match(command, /packages[\\/]reporting[\\/]src[\\/]hooks[\\/]report\.ts/, "the hook points at the reporting package");
  const config = readFileSync(codex, "utf8");
  assert.match(config, /\[mcp_servers\.other\]/, "unrelated Codex servers survive");
  assert.equal(config.split("[mcp_servers.factory-report]").length, 2, "one managed server");
  assert.match(config, /env = \{ FACTORY_REPORTER = "mcp" \}/);

  const second = wireHarnessReporting(root, home);
  assert.deepEqual(second.changed, [], "a second pass changes nothing");
  assert.deepEqual(second.unchanged.sort(), [claude, codex].sort());
  assert.equal(readFileSync(codex, "utf8").split("marshal-factory reporting: begin").length, 2, "the managed block is replaced, not appended twice");
  console.log("Harness reporting wiring regressions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
