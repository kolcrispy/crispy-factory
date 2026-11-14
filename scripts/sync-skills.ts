import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const targetIndex = args.indexOf("--target");
const target = resolve(targetIndex < 0 ? join(homedir(), ".agents", "skills", "factory-jobs") : args[targetIndex + 1] ?? "");
const source = resolve(import.meta.dirname, "../.agents/skills/factory-jobs");
if (target === source) throw new Error("Target must differ from authoritative repository skill");
const files = (root: string, prefix = ""): string[] => existsSync(root) ? readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name), join(prefix, entry.name)) : [join(prefix, entry.name)]).sort() : [];
if (!check) {
  cpSync(source, target, { recursive: true });
  console.log(`Synchronized Factory skill to ${target}`);
} else if (targetIndex < 0) {
  // CI checks a freshly installed copy, never a developer's home directory.
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const temp = mkdtempSync(join(tmpdir(), "factory-skill-"));
  try {
    const installed = join(temp, "factory-jobs");
    const sync = Bun.spawnSync([process.execPath, import.meta.filename, "--target", installed], { stdout: "pipe", stderr: "inherit" });
    if (sync.exitCode) throw new Error("Skill installation failed");
    const parity = Bun.spawnSync([process.execPath, import.meta.filename, "--check", "--target", installed], { stdout: "inherit", stderr: "inherit" });
    if (parity.exitCode) throw new Error("Installed skill parity failed");
  } finally { rmSync(temp, { recursive: true, force: true }); }
} else {
  const expected = files(source);
  const actual = files(target);
  const changed = [...new Set([...expected, ...actual])].filter(file => !expected.includes(file) || !actual.includes(file) || !readFileSync(join(source, file)).equals(readFileSync(join(target, file))));
  if (changed.length) throw new Error(`Skill drift in ${relative(process.cwd(), target)}: ${changed.join(", ")}`);
  console.log("Factory skill parity passed");
}
