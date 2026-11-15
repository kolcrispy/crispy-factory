import "./test-guard";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupHarnessReporting } from "@factory/runner/reporting-cleanup";

const home = mkdtempSync(join(tmpdir(), "factory-wiring-"));
const root = join(home, "factory", "packages", "reporting", "src");
const claude = join(home, ".claude", "settings.json");
const codex = join(home, ".codex", "config.toml");
try {
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  const ours = `bun "${join(root, "hooks/report.ts")}"`;
  writeFileSync(claude, JSON.stringify({ model: "user-model", hooks: { Stop: [{ hooks: [{ type: "command", command: ours }, { type: "command", command: "echo user-hook" }] }] } }));
  const marker = '# crispy-factory reporting: begin\n[mcp_servers.factory-report]\ncommand = "bun"\nargs = [' + JSON.stringify(join(root, "mcp/factory-report.ts")) + ']\n# crispy-factory reporting: end';
  writeFileSync(codex, 'model = "user-model"\n' + marker + '\n[mcp_servers.other]\ncommand = "other"\n');
  const first = cleanupHarnessReporting(root, home);
  assert.deepEqual(first.failed, []);
  const settings = JSON.parse(readFileSync(claude, "utf8"));
  assert.equal(settings.model, "user-model");
  assert.deepEqual(settings.hooks.Stop[0].hooks, [{ type: "command", command: "echo user-hook" }], "mixed entries retain user hooks");
  const config = Bun.TOML.parse(readFileSync(codex, "utf8")) as { mcp_servers: Record<string, unknown> };
  assert.deepEqual(config.mcp_servers, { other: { command: "other" } });
  assert.deepEqual(cleanupHarnessReporting(root, home), { changed: [], failed: [] }, "cleanup is idempotent");
  writeFileSync(codex, marker.replaceAll(JSON.stringify(join(root, "mcp/factory-report.ts")), '"/user/factory-report.ts"'));
  assert.deepEqual(cleanupHarnessReporting(root, home).changed, [], "foreign marked servers are not owned");
  console.log("Reporting cleanup regressions passed");
} finally {
  rmSync(home, { recursive: true, force: true });
}
