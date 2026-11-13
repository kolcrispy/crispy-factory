import { desc, eq } from "drizzle-orm";
import { hostname, userInfo } from "node:os";
import { z } from "zod";
import { db } from "@factory/storage/client";
import { jobs, machines, jobEvidence, intents, events, auditLog, runs } from "@factory/storage/schema";
import { trustedOperator } from "@factory/core/auth/owner";
import { inboxDeps } from "@factory/core/inbox-deps";
import * as inbox from "@factory/core/inbox-actions";
import { inboxKind } from "@factory/core/inbox";
import { archiveJobs, unarchiveJobs } from "@factory/core/archive-actions";
import { newJobDeps } from "@factory/core/new-job-deps";
import { createJob } from "@factory/core/new-job";
import { readSettings, saveSettings, writeSettings } from "@factory/core/settings";
import { reportedHarnesses } from "@factory/core/machine";
import { readRegistry, saveRepository, writeRepository, makeDefaultRepo, writeDefaultRepo } from "@factory/core/repositories";
import { readNotifications, saveNotifications, requestSlackTest } from "@factory/core/notifications";
import { installationRepos } from "@factory/integrations/github/installation";
import { modalEnvConfigured, modalSecretStore } from "@factory/integrations/modal-secrets";
import { addRepository, listAddable, writeNewRepository, repositoryRequest, retryOnboarding, rebuildRepoImage, writeRepoRequest, saveRepoSecrets, recordSecretNames } from "@factory/core/repo-onboarding";
import { panelSource } from "@factory/core/sources/index";
import { parseJobId } from "@factory/core/sources/shapes";

type Result = { ok?: boolean; status?: string | number; [key: string]: unknown };
const inputSchema = z.record(z.string(), z.unknown());
const text = (input: Record<string, unknown>, key: string) => z.string().min(1).parse(input[key]);

export async function operator(resource: string, action: string, raw: unknown, actor = `local:${userInfo().username}@${hostname()}`, wait?: number): Promise<Result> {
  const input = inputSchema.parse(raw);
  const user = async () => trustedOperator(actor);
  const deps = inboxDeps(user);
  const registry = () => readRegistry(db);
  const replay = (kind: "onboard_repo" | "rebuild_repo_image", repo: string, requestId: string) => repositoryRequest(db, kind, repo, requestId);
  const harnesses = async () => reportedHarnesses(await db.select().from(machines), Date.now());
  const notificationDeps = { db, user };
  let result: Result;
  const key = `${resource} ${action}`;
  switch (key) {
    case "jobs list": result = { jobs: await db.select().from(jobs).orderBy(desc(jobs.claimed_at)).limit(200) }; break;
    case "jobs show": {
      const id = parseJobId(text(input, "jobId")).id;
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return { ok: false, message: "No such job." };
      const [history, audit, attempts] = await Promise.all([
        db.select().from(events).where(eq(events.job_key, job.key)).orderBy(desc(events.at)).limit(200),
        db.select().from(auditLog).where(eq(auditLog.job_id, id)).orderBy(desc(auditLog.at)).limit(50),
        db.select().from(runs).where(eq(runs.job_key, job.key)).orderBy(desc(runs.last_event_at)).limit(200),
      ]);
      result = { job, history, audit, attempts };
      break;
    }
    case "machines list": result = { machines: await db.select().from(machines) }; break;
    case "evidence list": result = { evidence: await db.select().from(jobEvidence).where(eq(jobEvidence.job_key, text(input, "jobKey"))).orderBy(desc(jobEvidence.recorded_at)).limit(100) }; break;
    case "inbox list": result = { jobs: (await db.select().from(jobs).orderBy(desc(jobs.claimed_at))).filter(job => inboxKind(job)) }; break;
    case "settings show": result = { settings: await readSettings(db) }; break;
    case "settings save": result = await saveSettings({ user, harnesses, save: (choice, by) => writeSettings(db, choice, by, new Date()) }, input); break;
    case "repositories list": result = { repositories: await registry() }; break;
    case "repositories save": result = await saveRepository({ user, registry, harnesses, save: (choice, by) => writeRepository(db, choice, by, new Date()) }, input); break;
    case "repositories default": result = await makeDefaultRepo({ user, registry, save: (repo, by) => writeDefaultRepo(db, repo, by, new Date()) }, input); break;
    case "repositories addable": result = await listAddable({ user, registry, installable: installationRepos }); break;
    case "repositories add": result = await addRepository({ user, registry, replay, installable: installationRepos, create: (repo, by, requestId) => writeNewRepository(db, repo, by, new Date(), requestId), syncLabels: groups => panelSource().panelSyncLabelGroups!(groups) }, input); break;
    case "repositories retry":
    case "repositories rebuild": {
      const request = (kind: "onboard_repo" | "rebuild_repo_image", repo: string, requestId: string) => writeRepoRequest(db, kind, repo, new Date(), requestId);
      result = await (action === "retry" ? retryOnboarding : rebuildRepoImage)({ user, registry, request, replay }, input); break;
    }
    case "repositories secrets": result = await saveRepoSecrets({ user, registry, modalConfigured: modalEnvConfigured, upsert: (name, entries) => modalSecretStore().upsert(name, entries), recordNames: (repo, names) => recordSecretNames(db, repo, names, new Date()) }, input); break;
    case "notifications show": result = { notifications: await readNotifications(db) }; break;
    case "notifications save": result = await saveNotifications(notificationDeps, input); break;
    case "notifications test": result = await requestSlackTest(notificationDeps, text(input, "requestId")); break;
    case "jobs create": result = await createJob(newJobDeps(user), input); break;
    case "jobs archive": result = await archiveJobs(deps, input.jobIds ?? [text(input, "jobId")]); break;
    case "jobs unarchive": result = await unarchiveJobs(deps, input.jobIds ?? [text(input, "jobId")]); break;
    case "requests show": return requestResult(text(input, "intentId"), wait);
    default: {
      const id = parseJobId(text(input, "jobId")).id;
      const requestId = z.uuid().parse(input.requestId);
      const body = typeof input.body === "string" ? input.body : "";
      switch (key) {
        case "jobs answer": result = await inbox.answerQuestion(deps, id, requestId, body); break;
        case "jobs changes": result = await inbox.requestChanges(deps, id, requestId, body); break;
        case "jobs stop": result = await inbox.requestStop(deps, id, requestId, body); break;
        case "jobs approve": result = await inbox.approveMerge(deps, id, requestId, typeof input.headSha === "string" ? input.headSha : null); break;
        case "jobs close": result = await inbox.closeJob(deps, id, requestId, body); break;
        case "jobs dismiss": result = await inbox.dismissJob(deps, id); break;
        case "jobs retry": result = await inbox.retryFailed(deps, id, requestId, body); break;
        case "jobs retry-stop": result = await inbox.retryStop(deps, id, requestId); break;
        case "jobs follow-up": result = await inbox.fileFollowUp(deps, id, requestId, body); break;
        default: throw new Error("Unknown command. Use --help.");
      }
    }
  }
  if (result.ok && typeof result.intentId === "string") return { ...result, requestId: input.requestId, ...await requestResult(result.intentId, wait) };
  return result;
}

async function requestResult(intentId: string, wait?: number): Promise<Result> {
  const end = Date.now() + (wait ?? 0) * 1000;
  for (;;) {
    const [intent] = await db.select().from(intents).where(eq(intents.id, intentId));
    if (!intent) return { ok: false, status: "failed", message: "No such request." };
    if (intent.handled_at) {
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(intent.result ?? "{}");
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid result");
      } catch {
        return { intentId, status: "failed", message: "The runner's stored result could not be read." };
      }
      const refused = Object.values(result).some(value => value && typeof value === "object" && ("refused" in value || "blocked" in value));
      return { intentId, status: "error" in result ? "failed" : refused ? "refused" : "done", result };
    }
    if (wait === undefined) return { intentId, status: "queued" };
    if (Date.now() >= end) return { intentId, status: "timeout", message: "Accepted work remains queued; waiting timed out." };
    await Bun.sleep(Math.min(500, end - Date.now()));
  }
}
