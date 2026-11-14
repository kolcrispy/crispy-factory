import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { OmpRpc } from "@factory/integrations/omp-rpc";
import { ompCommand } from "@factory/platform/omp";
import { exec } from "@factory/platform/exec";
import { reportEvents } from "@factory/core/outbox";
import type { FactoryEvent, Usage } from "@factory/core/events";
import type { Harness } from "@factory/core/harness";
import type { LaunchEntry } from "./launch";
import type { InterruptOutcome, SubagentThread, ThreadActivity, ThreadRead } from "./threads";

const recordSchema = z.object({
  id: z.string(), key: z.string(), attempt: z.number().int().positive(), repo: z.string(), role: z.enum(["builder", "reviewer"]).optional(),
  branch: z.string(), cwd: z.string(), model: z.string(), sessionDir: z.string(),
  sessionId: z.string().optional(), sessionFile: z.string().optional(), pid: z.number().optional(),
  started: z.boolean(), pendingMessage: z.string().optional(), delivery: z.enum(["uncertain", "accepted"]).optional(),
  needsResume: z.boolean().default(false),
  children: z.record(z.string(), z.string()).default({}),
});
type AttemptRecord = z.infer<typeof recordSchema>;
const stateSchema = z.object({
  sessionId: z.string(), sessionFile: z.string().optional(), isSettled: z.boolean(),
  isStreaming: z.boolean(), model: z.object({ id: z.string(), provider: z.string() }).optional(),
});
type State = z.infer<typeof stateSchema>;
const subagentsSchema = z.object({ subagents: z.array(z.object({ id: z.string(), status: z.string(), sessionFile: z.string().optional() })) });
const statsSchema = z.object({ tokens: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() }) });
const messagesSchema = z.object({ messages: z.array(z.object({
  role: z.string(), model: z.string().optional(), provider: z.string().optional(),
  usage: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() }).optional(),
})) });
const active = new Map<string, { rpc: OmpRpc; record: AttemptRecord; lastMessage: string | null; status: string | null }>();
const connections = new Map<string, Promise<void>>();
export const ompRuntime = {
  root: join(homedir(), ".local/state/crispy-factory/omp"),
  command: ompCommand,
  report: (events: FactoryEvent[]) => reportEvents(events, 3000),
};
export const ompIdentity = (key: string, attempt: number) => `omp:${key}:${attempt}`;
export const isOmp = (id: string | null | undefined) => Boolean(id?.startsWith("omp:"));
const fileOf = (id: string) => join(ompRuntime.root, `${createHash("sha256").update(id).digest("hex")}.json`);
const readRecord = (id: string) => recordSchema.parse(JSON.parse(readFileSync(fileOf(id), "utf8")));
function save(record: AttemptRecord) {
  const path = fileOf(record.id);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
const extension = join(import.meta.dirname, "../../../packages/reporting/src/omp-extension.ts");
const baseArgs = (cwd: string) => ["--mode", "rpc", "--no-ui", "--no-extensions", "--approval-mode", "yolo", "--cwd", cwd];

async function usage(rpc: OmpRpc, record: AttemptRecord, turn = false, lastMessage?: string | null) {
  const stats = statsSchema.parse(await rpc.request({ type: "get_session_stats" }));
  const totals: Usage = { ...stats.tokens, model: record.model };
  const liveChildren = subagentsSchema.parse(await rpc.request({ type: "get_subagents" }));
  const children = { subagents: [...liveChildren.subagents, ...Object.entries(record.children).filter(([id]) => !liveChildren.subagents.some(child => child.id === id)).map(([id, sessionFile]) => ({ id, sessionFile, status: "completed" }))] };
  const agents: { agentId: string; usage: Usage }[] = [];
  for (const child of children.subagents) {
    if (!child.sessionFile) continue;
    const text = readFileSync(child.sessionFile, "utf8");
    const entries = text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; message?: unknown });
    const transcript = messagesSchema.parse({ messages: entries.filter(entry => entry.type === "message").map(entry => entry.message) });
    const childUsage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, model: record.model };
    for (const message of transcript.messages) {
      if (message.role !== "assistant" || !message.usage) continue;
      for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) childUsage[key] += message.usage[key];
      if (message.model) childUsage.model = message.provider ? `${message.provider}/${message.model}` : message.model;
    }
    agents.push({ agentId: child.id, usage: childUsage });
  }
  if (agents.length) await ompRuntime.report([{
    kind: "usage", eventId: `omp-agents:${record.id}:${createHash("sha256").update(JSON.stringify(agents)).digest("hex")}`,
    sessionId: record.id, at: Date.now(), usage: totals, agents,
  }]);
  const fingerprint = [totals.input, totals.output, totals.cacheRead, totals.cacheWrite].join(":");
  await ompRuntime.report([{
    eventId: `omp-${turn ? "turn" : "usage"}:${record.id}:${fingerprint}`,
    sessionId: record.id, at: Date.now(), kind: turn ? "turn_stop" : "usage", usage: totals,
    ...(turn && lastMessage ? { lastMessage: lastMessage.slice(0, 500) } : {}),
    ...(record.sessionFile ? { transcriptPath: record.sessionFile } : {}),
  }]);
}

async function connect(record: AttemptRecord) {
  if (record.pid && alive(record.pid)) throw new Error(`OMP attempt ${record.id} is held by process ${record.pid}; refusing duplicate execution.`);
  if (record.sessionId) {
    const lease = await exec(ompRuntime.command(), ["session", "lease", "--json", "--", record.sessionId], { timeoutMs: 15_000 });
    const checked = z.object({ held: z.array(z.string()), unknown: z.array(z.string()) }).parse(JSON.parse(lease.stdout));
    if (checked.held.length || checked.unknown.length) throw new Error(`OMP session ownership is held or unknown for ${record.id}.`);
  }
  if (record.started && (!record.sessionFile || !existsSync(record.sessionFile))) {
    throw new Error(`OMP attempt ${record.id} has no persisted transcript; refusing a fresh session.`);
  }
  const args = [...baseArgs(record.cwd), "--session-dir", record.sessionDir, "--trusted-extension", extension];
  if (record.sessionFile) args.push("--resume", record.sessionFile);
  if (record.model) args.push("--model", record.model);
  const rpc = new OmpRpc({ command: ompRuntime.command(), args, cwd: record.cwd,
    env: { ...process.env, FACTORY_JOB_KEY: record.role === "reviewer" ? "" : record.key, FACTORY_ATTEMPT: String(record.attempt), FACTORY_SESSION_ID: record.id, FACTORY_REPO: record.repo.split("/").pop()!, FACTORY_REPORTER: "mcp" },
    onEvent: frame => {
      const item = active.get(record.id);
      if (!item) return;
      if (frame.type === "subagent_lifecycle" || frame.type === "subagent_progress") {
        const child = frame.payload as { id?: string; sessionFile?: string } | undefined;
        if (child?.id && child.sessionFile) {
          record.children[child.id] = child.sessionFile;
          save(record);
        }
      }
      if (frame.type === "message_end") {
        const message = frame.message as { role?: string; content?: { type: string; text?: string }[]; stopReason?: string } | undefined;
        if (message?.role === "assistant") {
          item.lastMessage = message.content?.filter(c => c.type === "text").map(c => c.text ?? "").join("\n") ?? null;
          item.status = message.stopReason === "error" ? "failed" : message.stopReason === "aborted" ? "interrupted" : "completed";
        }
      }
      if (frame.type === "session_settled") {
        record.needsResume = false;
        save(record);
        void usage(rpc, record, true, item.lastMessage).catch(error => console.error(JSON.stringify({ event: "omp:report-error", id: record.id, error: String(error) })));
      }
    },
  });
  record.pid = rpc.process.pid;
  save(record);
  active.set(record.id, { rpc, record, lastMessage: null, status: null });
  void rpc.exited.then(() => {
    if (active.get(record.id)?.rpc === rpc) active.delete(record.id);
  });
  try {
    await rpc.request({ type: "set_subagent_subscription", level: "progress" });
    const state = stateSchema.parse(await rpc.request({ type: "get_state" }));
    if (record.sessionId && record.sessionId !== state.sessionId) throw new Error("OMP resumed a different session; refusing to continue.");
    if (!state.sessionFile) throw new Error("OMP returned no durable session file.");
    record.sessionId = state.sessionId;
    record.sessionFile = state.sessionFile;
    save(record);
    await ompRuntime.report([{
      eventId: `omp-start:${record.id}`, sessionId: record.id, at: Date.now(), kind: "session_start",
      cwd: record.cwd, branch: record.role === "reviewer" ? undefined : record.branch, repo: record.repo.split("/").pop()!, model: record.model,
      t3ThreadId: record.id, transcriptPath: record.sessionFile,
    }]);
    if (record.needsResume && record.delivery === "accepted" && state.isSettled) {
      await rpc.request({ type: "prompt", message: "Factory runner recovered this same attempt after an interruption. Reconcile the existing worktree and transcript, then continue the outstanding task. Do not repeat completed actions or create another attempt. Report your current stage through report_stage." });
    }
    return { rpc, state };
  } catch (error) {
    await rpc.close();
    active.delete(record.id);
    throw error;
  }
}

async function owned(id: string) {
  const current = active.get(id);
  if (current && !connections.has(id)) return current;
  let pending = connections.get(id);
  if (!pending) {
    pending = connect(readRecord(id)).then(() => {});
    connections.set(id, pending);
  }
  try { await pending; }
  finally { if (connections.get(id) === pending) connections.delete(id); }
  const connected = active.get(id);
  if (!connected) throw new Error(`OMP attempt ${id} exited while connecting.`);
  return connected;
}

export async function startOmp(entry: LaunchEntry, checkout: string, workRoot: string, review?: { id: string; cwd: string }) {
  const id = review?.id ?? ompIdentity(entry.key, entry.attempt);
  let record: AttemptRecord;
  if (existsSync(fileOf(id))) record = readRecord(id);
  else {
    const cwd = review?.cwd ?? join(workRoot, ".factory-worktrees", entry.key, String(entry.attempt));
    mkdirSync(dirname(cwd), { recursive: true });
    // Record the reservation before filesystem effects. Partial creation must never launch twice.
    record = { id, key: entry.key, attempt: entry.attempt, repo: entry.repo, branch: entry.branch, cwd, ...(review && { role: "reviewer" as const }),
      model: entry.harness.model, sessionDir: join(ompRuntime.root, "sessions", entry.key, String(entry.attempt), ...(review ? [id.replaceAll(":", "-")] : [])), started: false, needsResume: false, children: {}, pendingMessage: entry.message };
    save(record);
    if (!review) await exec("git", ["worktree", "add", "-b", entry.branch, cwd, entry.base], { cwd: checkout, timeoutMs: 120_000 });
  }
  const current = await owned(id);
  if (current.record.pendingMessage) {
    record = current.record;
    // Persist the uncertainty before sending: recovery must not replay a possibly accepted prompt.
    const message = record.pendingMessage!;
    record.started = true;
    delete record.pendingMessage;
    record.delivery = "uncertain";
    record.needsResume = true;
    save(record);
    try {
      await current.rpc.request({ type: "prompt", message });
      record.delivery = "accepted";
      save(record);
    } catch (error) {
      throw Object.assign(new Error(`OMP launch delivery is uncertain: ${String(error)}`), { executionUncertain: true });
    }
  }
  return id;
}

export async function recoverOmp(key: string, attempt: number, identity = ompIdentity(key, attempt)) {
  const id = identity;
  if (!existsSync(fileOf(id))) throw new Error(`OMP launch ${id} has no durable record; inspect before retrying.`);
  const record = readRecord(id);
  if (record.pendingMessage) throw new Error(`OMP launch ${id} was not delivered; inspect before retrying.`);
  if (record.delivery === "uncertain") throw new Error(`OMP launch ${id} has uncertain prompt delivery; inspect before retrying.`);
  await owned(id);
  return id;
}

export async function readOmp(id: string): Promise<{ read: ThreadRead; activity: ThreadActivity }> {
  const item = await owned(id);
  const state: State = stateSchema.parse(await item.rpc.request({ type: "get_state" }));
  const stateName = state.isSettled ? "stopped" : "running";
  return { read: { state: stateName, status: item.status, lastMessage: item.lastMessage, checkout: item.record.cwd },
    activity: { state: stateName, activeRunId: state.isSettled ? null : state.sessionId, projectId: item.record.id } };
}

export async function sendOmp(id: string, message: string) {
  const item = await owned(id);
  item.record.needsResume = true;
  save(item.record);
  await item.rpc.request({ type: "prompt", message, streamingBehavior: "followUp" });
}

export async function ompSubagents(id: string): Promise<SubagentThread[]> {
  const item = await owned(id);
  const result = subagentsSchema.parse(await item.rpc.request({ type: "get_subagents" }));
  return result.subagents.map(s => ({ threadId: `${id}/subagent/${s.id}`, status: ["running", "pending"].includes(s.status) ? "running" : s.status,
    latestRunId: s.id }));
}

export async function interruptOmp(id: string): Promise<InterruptOutcome> {
  const [parent, child] = id.split("/subagent/");
  const item = await owned(parent!);
  if (child) await item.rpc.request({ type: "cancel_subagent", subagentId: child });
  else {
    item.record.needsResume = false;
    save(item.record);
    const subs = subagentsSchema.parse(await item.rpc.request({ type: "get_subagents" }));
    for (const sub of subs.subagents) if (["running", "pending"].includes(sub.status)) await item.rpc.request({ type: "cancel_subagent", subagentId: sub.id });
    await item.rpc.request({ type: "abort" });
  }
  return { kind: "requested" };
}

export async function reconcileOmpUsage(id: string) {
  const item = await owned(id);
  await usage(item.rpc, item.record);
}

export async function closeOmpSessions() {
  for (const [id, item] of active) {
    const continueAfterRestart = item.record.needsResume;
    await interruptOmp(id);
    const deadline = Date.now() + 30_000;
    while (!stateSchema.parse(await item.rpc.request({ type: "get_state" })).isSettled) {
      if (Date.now() >= deadline) throw new Error(`OMP attempt ${id} has not settled; ownership remains held.`);
      await Bun.sleep(100);
    }
    await usage(item.rpc, item.record);
    await item.rpc.close();
    delete item.record.pid;
    item.record.needsResume = continueAfterRestart;
    save(item.record);
    active.delete(id);
  }
}

export async function readOmpHarness(): Promise<Harness | null> {
  const rpc = new OmpRpc({ command: ompRuntime.command(), args: [...baseArgs(homedir()), "--allow-home", "--no-session"], cwd: homedir() });
  try {
    const [available, current] = await Promise.all([rpc.request({ type: "get_available_models" }), rpc.request({ type: "get_state" })]);
    const result = z.object({ models: z.array(z.object({ provider: z.string(), id: z.string(), name: z.string().optional() })) }).parse(available);
    const state = z.object({ model: z.object({ provider: z.string(), id: z.string() }).optional() }).parse(current);
    const defaultModel = state.model ? `${state.model.provider}/${state.model.id}` : undefined;
    if (!defaultModel || !result.models.some(m => `${m.provider}/${m.id}` === defaultModel)) return null;
    return { id: "omp", driver: "omp", name: "OMP", enabled: true, defaultModel,
      models: result.models.map(m => ({ slug: `${m.provider}/${m.id}`, name: m.name ?? `${m.provider}/${m.id}` })) };
  } catch { return null; }
  finally { await rpc.close(); }
}
