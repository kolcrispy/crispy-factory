import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(root, "apps/herdr/mods/factory");
const home = process.env.HERDR_APP_HOME ?? join(homedir(), ".config/herdr-app");
const target = join(home, "mods/factory");
const run = async (args: string[]) => {
  const child = Bun.spawn(["herdr-app", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(error || out || "Herdr command failed.");
  return out;
};
await run(["check", source]);
if (existsSync(target) && !existsSync(join(target, "factory-managed.json"))) throw new Error(`Refusing to overwrite an unmanaged mod: ${target}`);
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true, filter: path => !["gpui-kit.d.ts", "jsconfig.json"].includes(path.split(/[\\/]/).pop() ?? "") });
writeFileSync(join(target, "factory-managed.json"), JSON.stringify({ source }, null, 2));
writeFileSync(join(target, "local.json"), JSON.stringify({ factoryHome: root, bun: process.execPath, platform: process.platform }, null, 2));
console.log(`Installed Factory mod: ${target}`);
// Integrate with the user's custom Rig workspace, preserving its other panels.
const layoutPath = join(home, "layouts/rig-workspace.json");
const tabsPath = join(home, "mods/rig-workspace-tabs/main.js");
const workspace = JSON.parse(readFileSync(layoutPath, "utf8"));
type Block = { id: string; type?: string; children?: Block[]; content?: { mod?: string } };
const find = (node: Block, id: string): Block | undefined => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);
const body = find(workspace, "panel-body");
if (!body?.children) throw new Error("Expected the custom workspace panel stack.");
let tabs = readFileSync(tabsPath, "utf8");
const enabledAnchor = 'const enabled = [...(shared("workspace.panels") ?? ["files", "changes"])];';
const buttonAnchor = '.child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))';
if (!tabs.includes(enabledAnchor) || !tabs.includes(buttonAnchor)) throw new Error("Rig workspace selector changed; refusing an unsafe patch.");
if (!tabs.includes('enabled.push("factory")')) tabs = tabs.replace(enabledAnchor, `${enabledAnchor}\n    if (!enabled.includes("factory")) enabled.push("factory");`);
if (!tabs.includes('panelButton("factory",')) tabs = tabs.replace(buttonAnchor, `${buttonAnchor}\n      .child(panelButton("factory", "Factory", "mods/factory/refresh.svg"))`);
if (!body.children.some(child => child.id === "factory")) body.children.push({ id: "factory", type: "block", content: { mod: "factory" } });
writeFileSync(tabsPath, tabs);
writeFileSync(layoutPath, JSON.stringify(workspace, null, 2) + "\n");
if (!process.argv.includes("--no-open")) {
  const status = JSON.parse(await run(["status"]));
  if (status.layout !== "rig-workspace") throw new Error("Select the Rig workspace layout, then rerun to open Factory.");
  await run(["do", "layout.select", JSON.stringify({ stack: "panel-body", child: "factory" })]);
  await run(["do", "layout.show", JSON.stringify({ id: "panel" })]);
  console.log("Opened Factory workspace panel.");
}
