import { z } from "zod";
import type { ExecError } from "@factory/platform/exec";
import { localHost, type JobHost } from "@factory/core/host";
import { withPlaybook } from "@factory/core/playbook";
import { listThreads, showThread, startThread as t3Start } from "@factory/integrations/t3-client";
import type { HarnessChoice } from "@factory/core/settings";
import { withRepoDefaults, readRegistry } from "@factory/core/repositories";
import { db } from "@factory/storage/client";
import { readHarnesses } from "@factory/integrations/t3-state";
import { PENDING } from "./binding";
import { thisMachine } from "./heartbeat";
import { bindThread, claimLaunch, config, factoryCheckouts, launchSettings, machineInFlight, pendingLaunches, releaseLaunch, toLaunch } from "./ops";
import { localizeJobImages } from "./job-images";

export class MaybeStartedError extends Error {}
export function parseThreadId(stdout: string) {
  try { return z.object({ threadId: z.string().min(1) }).parse(JSON.parse(stdout)).threadId; }
  catch { throw new MaybeStartedError("t3 thread start returned no valid thread identity."); }
}
export async function startThread(host: JobHost, repo: string, branch: string, title: string, message: string, { provider, model }: HarnessChoice, base = "origin/main") {
  return parseThreadId(await t3Start(host, { project: repo, message, worktree: base, branch, title, provider, model }));
}
export type LaunchEntry = {
  key: string; attempt: number; repo: string; branch: string; threadTitle: string; message: string;
  harness: HarnessChoice; base: string;
};
export type LaunchDeps = {
  claim: (key: string, marker: string) => Promise<boolean>;
  start: (entry: LaunchEntry) => Promise<string>;
  bind: (key: string, threadId: string) => Promise<unknown>;
  release: (key: string, marker: string) => Promise<unknown>;
  now: () => number;
};
export function maybeStarted(error: unknown) {
  if (error instanceof MaybeStartedError) return true;
  const failure = error as ExecError;
  if (failure?.code === "ENOENT") return false;
  return Boolean(failure?.killed || failure?.stdinError);
}
export async function launchEntries(entries: readonly LaunchEntry[], deps: LaunchDeps) {
  const results: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const marker = `${PENDING}${deps.now()}`;
    if (!(await deps.claim(entry.key, marker))) continue;
    let started = false;
    try {
      const threadId = await deps.start(entry);
      started = true;
      await deps.bind(entry.key, threadId);
      results.push({ key: entry.key, threadId, branch: entry.branch });
    } catch (error) {
      const ambiguous = started || maybeStarted(error);
      if (!ambiguous) await deps.release(entry.key, marker);
      results.push({ key: entry.key, error: error instanceof Error ? error.message.split("\n")[0] : String(error), retry: ambiguous ? "after launch recovery" : "next pass" });
    }
  }
  return results;
}
export async function recoverPending(checkouts: ReadonlyMap<string, string>) {
  const recovered = [];
  for (const pending of await pendingLaunches()) {
    if (!checkouts.has(pending.repo) || Date.now() - Number(pending.marker.slice(PENDING.length)) < 120_000) continue;
    const list = z.array(z.object({ threadId: z.string() })).parse(await listThreads(localHost, checkouts.get(pending.repo)!));
    let found: string | undefined;
    for (const thread of list) {
      const detail = z.object({ thread: z.object({ branch: z.string().nullable() }) }).parse(await showThread(localHost, thread.threadId));
      if (detail.thread.branch === pending.branch) { found = thread.threadId; break; }
    }
    await (found ? bindThread(pending.key, found) : releaseLaunch(pending.key, pending.marker));
    recovered.push({ key: pending.key, threadId: found ?? null });
  }
  return recovered;
}
export async function launchQueued(onWorktree: (check: Record<string, unknown>) => void = () => {}) {
  const [checkouts, registry, harnesses] = await Promise.all([factoryCheckouts(), readRegistry(db), readHarnesses()]);
  const recovered = await recoverPending(checkouts);
  const machine = await thisMachine();
  if (await machineInFlight(machine.id) >= config.factory.maxInFlight) return recovered;
  const settings = await launchSettings();
  const entries: LaunchEntry[] = [];
  for (const { job, ...entry } of await toLaunch()) {
    const repository = registry.find(row => row.repo === job.repo && row.enabled && row.registration_status === "ready");
    if (!repository?.default_branch || !checkouts.has(job.repo)) continue;
    const { defaults } = withRepoDefaults(settings, repository, harnesses);
    const requested = job.source_state.requestedProvider;
    const selected = requested ? harnesses?.find(harness => harness.id === requested && harness.enabled) : null;
    if (requested && !selected) continue;
    const harness = selected ? { provider: selected.id, model: selected.models[0]?.slug ?? defaults.harness.model } : defaults.harness;
    entries.push({ ...entry, harness, base: `origin/${repository.default_branch}` });
  }
  const slot = { id: machine.id, repos: [...checkouts.keys()], maxInFlight: config.factory.maxInFlight };
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const launched = await launchEntries(entries, {
    claim: (key, marker) => claimLaunch(key, marker, slot, byKey.get(key)!.harness),
    start: async entry => {
      const checkout = checkouts.get(entry.repo)!;
      await localHost.run("git", ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "fetch", "origin", "--prune"], { cwd: checkout, timeoutMs: 120_000 });
      const inputs = await localizeJobImages(entry.message, config.factory.workRoot, entry.key, entry.attempt);
      const message = await withPlaybook(inputs, localHost, checkout);
      const threadId = await startThread(localHost, checkout, entry.branch, entry.threadTitle, message, entry.harness, entry.base);
      onWorktree({ key: entry.key, threadId, base: entry.base });
      return threadId;
    },
    bind: bindThread, release: releaseLaunch, now: Date.now,
  });
  return [...recovered, ...launched];
}
