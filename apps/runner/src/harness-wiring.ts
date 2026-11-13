import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { json, withHooks, type Json } from "@factory/core/target-wiring";

/**
 * Reporting must reach the factory from every harness session without changing the user's
 * repository. Claude Code reads its user settings before any project; hooks installed there
 * check the checked-out branch and stay inert outside factory attempts. Codex has no hooks, so
 * its user config gets the factory-report MCP server instead.
 *
 * Both files are merged, not replaced: unrelated settings survive, and running again changes
 * nothing once the factory entries are present. `home` is injectable for regressions.
 */
const CODEX_BEGIN = "# crispy-factory reporting: begin";
const CODEX_END = "# crispy-factory reporting: end";

export type WireOutcome = { changed: string[]; unchanged: string[]; failed: { path: string; error: string }[] };

function writeIfChanged(path: string, content: string, outcome: WireOutcome) {
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    outcome.unchanged.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  outcome.changed.push(path);
}

function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

/** The Codex block this module owns: everything between its markers, replaced wholesale. */
function codexConfig(current: string, reportingRoot: string, outcomes: WireOutcome, path: string) {
  // Recognize the owned server block independently of the product name on its markers.
  const managed = /^# ([\w-]+) reporting: begin\r?\n\[mcp_servers\.factory-report\]\r?\n[\s\S]*?^# \1 reporting: end\r?$/m.exec(current);
  const before = managed ? current.slice(0, managed.index) : current.replace(/\s*$/, "\n");
  const after = managed ? current.slice(managed.index + managed[0].length).replace(/^\s*\n?/, "") : "";
  const server = [
    CODEX_BEGIN,
    "[mcp_servers.factory-report]",
    'command = "bun"',
    `args = [${JSON.stringify(join(reportingRoot, "mcp", "factory-report.ts"))}]`,
    'env = { FACTORY_REPORTER = "mcp" }',
    CODEX_END,
  ].join("\n");
  const next = `${before}${before && !before.endsWith("\n") ? "\n" : ""}${server}\n${after ? `\n${after}` : ""}`;
  if (current === next) {
    outcomes.unchanged.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  outcomes.changed.push(path);
}

export function wireHarnessReporting(reportingRoot: string, home = homedir()): WireOutcome {
  const outcome: WireOutcome = { changed: [], unchanged: [], failed: [] };
  const claude = join(home, ".claude", "settings.json");
  try {
    writeIfChanged(claude, json(withHooks(readJson(claude), reportingRoot)), outcome);
  } catch (error) {
    outcome.failed.push({ path: claude, error: error instanceof Error ? error.message : String(error) });
  }
  const codex = join(home, ".codex", "config.toml");
  try {
    const current = existsSync(codex) ? readFileSync(codex, "utf8") : "";
    codexConfig(current, reportingRoot, outcome, codex);
  } catch (error) {
    outcome.failed.push({ path: codex, error: error instanceof Error ? error.message : String(error) });
  }
  return outcome;
}
