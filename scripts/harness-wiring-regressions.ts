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
  const parsed = Bun.TOML.parse(config) as { model: string; mcp_servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> };
  assert.equal(parsed.model, "gpt-5");
  assert.equal(parsed.mcp_servers.other.command, "other", "unrelated Codex servers survive");
  assert.equal(parsed.mcp_servers["factory-report"].command, "bun");
  assert.deepEqual(parsed.mcp_servers["factory-report"].args, [join(root, "mcp", "factory-report.ts")]);
  assert.equal(parsed.mcp_servers["factory-report"].env?.FACTORY_REPORTER, "mcp");

  const second = wireHarnessReporting(root, home);
  assert.deepEqual(second.changed, [], "a second pass changes nothing");
  assert.deepEqual(second.unchanged.sort(), [claude, codex].sort());
  // A previous branding marker must upgrade without creating duplicate TOML tables.
  writeFileSync(codex, config.replaceAll("crispy-factory reporting:", "previous-product reporting:") + '\n[features]\nexample = true\n');
  const upgraded = wireHarnessReporting(root, home);
  assert.deepEqual(upgraded.failed, []);
  const upgradedConfig = Bun.TOML.parse(readFileSync(codex, "utf8"));
  assert.deepEqual(upgradedConfig, { ...parsed, features: { example: true } }, "upgrades preserve settings before and after the owned block");
  assert.deepEqual(wireHarnessReporting(root, home).changed, [], "upgraded config remains idempotent");
  console.log("Harness reporting wiring regressions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
