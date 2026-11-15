import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type Json = Record<string, unknown>;
export type CleanupOutcome = { changed: string[]; failed: { path: string; error: string }[] };

/** Explicit cleanup only: exact checkout paths prove ownership; unrelated hooks survive. */
export function cleanupHarnessReporting(reportingRoot: string, home = homedir()): CleanupOutcome {
  const outcome: CleanupOutcome = { changed: [], failed: [] };
  const owned = new Set(["report.ts", "budget.ts"].map(file => `bun "${join(reportingRoot, "hooks", file)}"`));
  const claude = join(home, ".claude", "settings.json");
  try {
    if (existsSync(claude)) {
      const current = readFileSync(claude, "utf8");
      const settings = JSON.parse(current) as Json;
      let changed = false;
      if (settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)) {
        for (const [event, entries] of Object.entries(settings.hooks)) {
          if (!Array.isArray(entries)) continue;
          const next = entries.flatMap(entry => {
            if (!entry || !Array.isArray(entry.hooks)) return [entry];
            const hooks = entry.hooks.filter((hook: { command?: string }) => !owned.has(hook.command ?? ""));
            if (hooks.length === entry.hooks.length) return [entry];
            changed = true;
            return hooks.length ? [{ ...entry, hooks }] : [];
          });
          (settings.hooks as Json)[event] = next;
        }
      }
      if (changed) {
        writeFileSync(`${claude}.factory-backup`, current, { flag: "wx" });
        writeFileSync(claude, `${JSON.stringify(settings, null, 2)}\n`);
        outcome.changed.push(claude);
      }
    }
  } catch (error) { outcome.failed.push({ path: claude, error: String(error) }); }
  const codex = join(home, ".codex", "config.toml");
  try {
    if (existsSync(codex)) {
      const current = readFileSync(codex, "utf8");
      const block = /^# ([\w-]+) reporting: begin\r?\n\[mcp_servers\.factory-report\]\r?\n[\s\S]*?^# \1 reporting: end\r?$/m.exec(current);
      if (block) {
        const config = Bun.TOML.parse(block[0]) as { mcp_servers?: Record<string, { command?: string; args?: string[] }> };
        const server = config.mcp_servers?.["factory-report"];
        if (server?.command === "bun" && server.args?.length === 1 && resolve(server.args[0]!) === resolve(reportingRoot, "mcp/factory-report.ts")) {
          writeFileSync(`${codex}.factory-backup`, current, { flag: "wx" });
          writeFileSync(codex, current.slice(0, block.index) + current.slice(block.index + block[0].length));
          outcome.changed.push(codex);
        }
      }
    }
  } catch (error) { outcome.failed.push({ path: codex, error: String(error) }); }
  return outcome;
}
