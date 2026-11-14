import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(root, "apps/herdr/mods/factory");
const target = join(process.env.HERDR_APP_HOME ?? join(homedir(), ".config/herdr-app"), "mods/factory");
const run = async (args: string[]) => {
  const child = Bun.spawn(["herdr-app", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(error || out || "Herdr command failed.");
  return out;
};
await run(["check", source]);
if (existsSync(target) && !existsSync(join(target, "factory-managed.json"))) throw new Error(`Refusing to overwrite an unmanaged mod: ${target}`);
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
writeFileSync(join(target, "factory-managed.json"), JSON.stringify({ source }, null, 2));
writeFileSync(join(target, "local.json"), JSON.stringify({ factoryHome: root, bun: process.execPath, platform: process.platform }, null, 2));
console.log(`Installed Factory mod: ${target}`);
if (!process.argv.includes("--no-open")) {
  const status = JSON.parse(await run(["status"]));
  if (!status.space) throw new Error("Select a Herdr workspace, then rerun the installer to open Factory.");
  const world = JSON.parse(await run(["ls"]));
  const spaces = Array.isArray(world) ? world : world.spaces;
  const space = spaces?.find((item: { id: string }) => item.id === status.space);
  const existing = space?.tabs?.find((tab: { name?: string }) => tab.name === "Factory");
  console.log(await run(["do", existing ? "tab.select" : "tab.new", JSON.stringify(existing ? { id: existing.id } : { space: status.space, name: "Factory", mod: "factory" })]));
}
