import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function ompCommand() {
  if (process.env.FACTORY_OMP_PATH) return process.env.FACTORY_OMP_PATH;
  const candidates = process.platform === "win32"
    ? [join(homedir(), ".bun/bin/omp.exe"), join(homedir(), ".local/bin/omp.exe")]
    : [join(homedir(), ".bun/bin/omp"), join(homedir(), ".local/bin/omp")];
  return candidates.find(existsSync) ?? "omp";
}
