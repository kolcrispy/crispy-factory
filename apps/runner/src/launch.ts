import { eq } from "drizzle-orm";
import { jobs } from "@factory/storage/schema";
import type { ExecError } from "@factory/platform/exec";
import { localHost } from "@factory/core/host";
import { withPlaybook } from "@factory/core/playbook";
import type { HarnessChoice } from "@factory/core/settings";
import { withRepoDefaults, readRegistry } from "@factory/core/repositories";
import { db } from "@factory/storage/client";
import { readHarnesses } from "./harnesses";
import { recoverOmp, startOmp } from "./omp";
import { PENDING } from "./binding";
import { thisMachine } from "./heartbeat";
import { bindThread, claimLaunch, config, factoryCheckouts, launchSettings, machineInFlight, pendingLaunches, releaseLaunch, toLaunch } from "./ops";
import { localizeJobImages } from "./job-images";

export class MaybeStartedError extends Error {}
export type LaunchEntry = {
  jobId: string; key: string; attempt: number; repo: string; branch: string; threadTitle: string; message: string;
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
  if (error instanceof Error && "executionUncertain" in error && error.executionUncertain === true) return true;
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
    try {
      const id = await recoverOmp(pending.key, pending.attempt, undefined, pending.jobId);
      await bindThread(pending.key, id);
      recovered.push({ key: pending.key, threadId: id });
    } catch (error) {
      recovered.push({ key: pending.key, held: true, error: String(error) });
    }
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
    const harness = selected && selected.id !== defaults.harness.provider ? { provider: selected.id, model: selected.defaultModel ?? "" } : { ...defaults.harness, model: defaults.harness.model || harnesses.find(runtime => runtime.id === defaults.harness.provider)?.defaultModel || "" };
    if (harness.provider === "omp" && !harnesses.some(runtime => runtime.id === "omp" && runtime.enabled && runtime.models.some(model => model.slug === harness.model))) continue;
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
      const [claimed] = await db.select().from(jobs).where(eq(jobs.key, entry.key));
      const message = `${await withPlaybook(inputs, localHost, checkout)}${claimed?.attempt_review?.policy.enabled ? "\n\n## Independent review gate\nImplement, test and commit the attempt branch. Run factory-verify --json and report_work handoff with its exact sha and eventId as evidenceEventId, then end the turn. Do not self-review, push or publish a PR. The runner publishes the revision only after independent PASS. Every repair requires fresh handoff." : ""}`;
      const threadId = await startOmp({ ...entry, message }, checkout, config.factory.workRoot);
      onWorktree({ key: entry.key, threadId, base: entry.base });
      return threadId;
    },
    bind: bindThread, release: releaseLaunch, now: Date.now,
  });
  return [...recovered, ...launched];
}
