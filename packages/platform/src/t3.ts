import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { exec, type ExecOptions } from "./exec";

export function t3Command() {
  if (process.env.T3CODE_CLI_PATH) return process.env.T3CODE_CLI_PATH;
  const candidates = process.platform === "win32"
    ? [join(homedir(), ".local/bin/t3.exe"), join(homedir(), ".t3/bin/t3.cmd")]
    : [join(homedir(), ".local/bin/t3"), join(homedir(), ".t3/bin/t3")];
  return candidates.find(existsSync) ?? "t3";
}

/** The desktop-generated cmd launcher has a fixed executable/script pair; avoid cmd.exe argument interpolation. */
export function runT3(command: string, args: string[], options?: ExecOptions) {
  if (process.platform !== "win32" || !command.toLowerCase().endsWith(".cmd")) return exec(command, args, options);
  const launcher = readFileSync(command, "utf8");
  const pair = /^"([^"\r\n]+\.exe)" "([^"\r\n]+\.mjs)" %\*/im.exec(launcher);
  if (!pair || !existsSync(pair[1]!)) throw new Error("Unsupported T3 cmd launcher. Install the native t3 executable or regenerate the desktop launcher.");
  return exec(pair[1]!, [pair[2]!, ...args], { ...options, env: { ...options?.env, ELECTRON_RUN_AS_NODE: "1", T3CODE_DESKTOP_CLI_LAUNCHER: "1", T3CODE_CLI_PATH: command } });
}
