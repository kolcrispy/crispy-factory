import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Windows' system bash is WSL, not a local execution shell. */
export function localShell() {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), NODE_ENV: process.env.NODE_ENV };
  if (process.platform !== "win32") return { command: "bash", env };
  const git = Bun.which("git");
  const candidates = [
    process.env.FACTORY_BASH_PATH,
    ...(git ? [join(dirname(git), "bash.exe"), join(dirname(git), "../bin/bash.exe")] : []),
    ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:/Program Files"].filter(Boolean).map(root => join(root!, "Git/bin/bash.exe")),
  ];
  const command = candidates.find(path => path && existsSync(path));
  if (!command) throw new Error("Install Git Bash or set FACTORY_BASH_PATH to a native bash executable");
  return { command, env: { ...env, npm_config_script_shell: command } };
}
