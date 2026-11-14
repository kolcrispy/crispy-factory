import "./test-guard";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Request } from "playwright";
import { manageOwner } from "@factory/core/auth/accounts";
import { db } from "@factory/storage/client";
import { jobs, repoSettings, machines } from "@factory/storage/schema";
import { internalJob } from "./fixtures";

if (process.env.FACTORY_DASHBOARD_SMOKE !== "1") {
  console.log("Dashboard browser smoke requires bun run smoke:dashboard");
  process.exit(77);
}
const workspace = resolve(import.meta.dirname, "..");
const root = join(workspace, ".scratch", `dashboard-smoke-${crypto.randomUUID()}`);
const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = listener.port!;
listener.stop(true);
const origin = `http://127.0.0.1:${port}`;
const email = "smoke@example.invalid";
const password = crypto.randomUUID();
await manageOwner("create", email, password);
await db.insert(repoSettings).values({ repo: "smoke/isolated", updated_by: email, updated_at: new Date() });
await db.insert(jobs).values(internalJob("dashboard-smoke", "JOB-9001", { repo: "smoke/isolated", stage: "verifying", title: "Isolated browser smoke", attempt: 1,
  attempt_review: { attempt: 1, policy: { enabled: true, provider: "omp", model: "smoke-model" }, state: "held", builderThreadId: "isolated-builder", builderSessionId: null, automaticRepairs: 2, rounds: [] },
}));
await db.insert(machines).values({ id: "dashboard-smoke", name: "Isolated smoke", last_seen_at: new Date(), heartbeat: {}, inventory: { runnerSha: "smoke", t3: "unknown", connect: "unknown", projects: { source: "unknown" }, repos: [], harnesses: [{ id: "omp", driver: "omp", name: "OMP", enabled: true, models: [{ slug: "smoke-model", name: "Smoke model" }] }] } });
mkdirSync(root, { recursive: true });
cpSync(join(workspace, "apps/dashboard"), root, { recursive: true, filter: source => !["node_modules", ".next"].includes(source.split(/[\\/]/).at(-1)!) });
symlinkSync(join(workspace, "apps/dashboard/node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
let logs = "";
const child = Bun.spawn([process.execPath, join(workspace, "node_modules/next/dist/bin/next"), "dev", root, "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, NODE_ENV: "development", FACTORY_DASHBOARD_URL: origin }, stdout: "pipe", stderr: "pipe",
});
const drain = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      logs = (logs + new TextDecoder().decode(value)).slice(-16000);
    }
  } finally { reader.releaseLock(); }
};
const drains = Promise.all([drain(child.stdout), drain(child.stderr)]);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const deadline = Date.now() + 120000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`Dashboard exited: ${child.exitCode}`);
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(5000) })).ok) break; } catch { /* Startup not ready. */ }
    if (Date.now() > deadline) throw new Error("Dashboard readiness timed out");
    await Bun.sleep(250);
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(origin);
  const login = await page.evaluate(async ({ email, password }) => (await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).status, { email, password });
  assert.equal(login, 200, "isolated owner can authenticate");
  // Exercise the real merge component without a runner or any GitHub writes.
  const { eq } = await import("drizzle-orm");
  const { intents } = await import("@factory/storage/schema");
  const sha = "a".repeat(40);
  const prUrl = "https://github.com/smoke/isolated/pull/1";
  await db.update(jobs).set({ stage: "pr", pr_url: prUrl, github_snapshot: { prUrl, attempt: 1, observedAt: new Date().toISOString(), state: "open", title: "Isolated merge", headSha: sha, mergeable: "mergeable", review: { headSha: sha, files: [], fileCount: 0, bugbot: { state: "reviewed", high: 0, medium: 0, low: 0, resolved: 0 } } } }).where(eq(jobs.key, "JOB-9001"));
  const [mergeJob] = await db.select().from(jobs).where(eq(jobs.key, "JOB-9001"));
  await Bun.write(join(root, "app/merge-smoke/page.tsx"), `import { MergeButton } from "../../components/panel/merge-button";\nexport default function Page() { return <MergeButton jobId={${JSON.stringify(mergeJob!.id)}} jobKey="JOB-9001" />; }`);
  await page.goto(origin + "/merge-smoke");
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 2000 });
  const queuedDeadline = Date.now() + 15000;
  let approval: typeof intents.$inferSelect | undefined;
  while (!approval && Date.now() < queuedDeadline) {
    [approval] = await db.select().from(intents).where(eq(intents.job_id, mergeJob!.id));
    if (!approval) await Bun.sleep(100);
  }
  assert.equal(approval?.kind, "approve_merge", "closing the dialog still persists the merge request");
  assert.equal(approval?.handled_at, null, "dialog closes before runner handles approval");
  console.log("Merge confirmation closes while durable approval remains pending");
  for (const route of ["/inbox?job=JOB-9001", "/settings", "/repositories?repo=smoke%2Fisolated"]) {
    const response = await page.goto(origin + route);
    assert.equal(response?.status(), 200, `${route} rendered successfully`);
    await page.locator("main").waitFor();
    if (route.startsWith("/inbox")) await page.getByText("Isolated browser smoke", { exact: true }).first().waitFor();
    await page.waitForTimeout(1500);
    const marker = await page.evaluate(() => performance.timeOrigin);
    let navigations = 0;
    const onNavigation = (request: Request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; };
    page.on("request", onNavigation);
    const log = join(root, ".next/dev/logs/next-development.log");
    mkdirSync(join(root, ".next/dev/logs"), { recursive: true });
    appendFileSync(log, "\n");
    await page.waitForTimeout(12000);
    assert.equal(await page.evaluate(() => performance.timeOrigin), marker, `${route} retained its document`);
    assert.equal(navigations, 0, `${route} did not reload across polling and generated-log writes`);
    page.off("request", onNavigation);
    assert.equal(new URL(page.url()).pathname, new URL(origin + route).pathname, "authentication stays on requested surface");
    assert.deepEqual(errors, [], "no browser runtime/console errors");
    console.log(`Stable dashboard surface: ${route}`);
  }
  const evidence = resolve(process.env.FACTORY_SMOKE_ARTIFACTS ?? join(workspace, ".scratch", "dashboard-smoke-evidence"));
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, "dashboard.png"), fullPage: true });
  assert.equal(child.exitCode, null, "dashboard stayed alive");
} catch (error) {
  console.error(logs);
  const evidence = resolve(process.env.FACTORY_SMOKE_ARTIFACTS ?? join(workspace, ".scratch", "dashboard-smoke-evidence"));
  mkdirSync(evidence, { recursive: true });
  await Bun.write(join(evidence, "failure.log"), logs);
  throw error;
} finally {
  await browser?.close();
  child.kill();
  await child.exited;
  await drains;
  rmSync(root, { recursive: true, force: true });
}
console.log("Isolated dashboard browser smoke passed");
