import "./test-guard";
import assert from "node:assert/strict";
import { eq, inArray, like } from "drizzle-orm";
import type { NewJobDeps } from "@factory/core/new-job";

const { db } = await import("@factory/storage/client");
const { auditLog, intents, jobs, repoSettings } = await import("@factory/storage/schema");
type RepoRow = typeof repoSettings.$inferSelect;
const repos = await import("@factory/core/repositories");
const { repoFilter } = await import("@factory/core/repo-filter");
const { createJob } = await import("@factory/core/new-job");

const OWNER = "owner@example.com";
process.env.FACTORY_OWNER_EMAILS = OWNER;
const owner = { email: OWNER, emailVerified: true };
const stamp = Date.now();
const OWNER_NS = `test-repos-${stamp}`;
const A = `${OWNER_NS}/factory-demo`;
const B = `${OWNER_NS}/shop`;
const OFF = `${OWNER_NS}/legacy`;

const row = (repo: string, over: Partial<RepoRow> = {}): RepoRow => ({
  repo,
  display_name: null,
  is_default: false,
  enabled: true,
  provider: null,
  model: null,
  review: null,
  autonomy: "off",
  protected_paths: null,
  max_changed_lines: null,
  require_bugbot: true,
  registration_status: "ready",
  registration_error: null,
  checkout_path: null,
  default_branch: "main",
  recipe: null,
  updated_at: new Date(),
  updated_by: "test",
  ...over,
});
const registry = [row(A, { is_default: true }), row(B, { display_name: "Shop app", provider: "codex" }), row(OFF, { enabled: false })];
// Precedence: ticket label > repo default > Settings, field by field.
const harness = (id: string, name: string, models: string[], enabled = true) => ({ id, driver: id, name, enabled, models: models.map((slug) => ({ slug, name: slug })) });
const harnesses = [harness("claudeAgent", "Claude Code", ["claude-opus-5-5", "claude-second"]), harness("codex", "Codex", ["gpt-6-astra", "gpt-second"]), harness("cursor", "Cursor", ["composer-2"]), harness("off", "Off", ["x"], false)];
const settings = { harness: { provider: "claudeAgent", model: "claude-opus-5-5", from: "settings" as const } };
assert.equal(repos.withRepoDefaults(settings, row(B, { provider: "codex" }), harnesses).defaults.harness.model, "gpt-6-astra", "a repo default harness starts on its first model");
const skipped = repos.withRepoDefaults(settings, row(B, { provider: "off" }), harnesses);
assert.deepEqual([skipped.defaults.harness.provider, skipped.problems.length], ["claudeAgent", 1], "a disabled default harness falls back to Settings, with a problem to log");
assert.equal(repos.withRepoDefaults(settings, row(B, { provider: "claudeAgent", model: "claude-second" }), harnesses).defaults.harness.model, "claude-second", "repo model overrides Settings even for the same harness");
assert.equal(repos.withRepoDefaults(settings, row(B, { provider: "codex", model: "gpt-second" }), harnesses).defaults.harness.model, "gpt-second", "repo model overrides the harness first model");
assert.deepEqual(repos.withRepoDefaults(settings, row(B, { provider: "codex", model: "gone" }), harnesses).defaults.harness, settings.harness, "removed models fall back to Settings");
const native = { ...harness("omp", "OMP", ["first", "native", "override"]), defaultModel: "native" };
assert.equal(repos.withRepoDefaults(settings, row(B, { provider: "omp" }), [native]).defaults.harness.model, "native", "OMP inherits its native selection rather than inventory order");
assert.equal(repos.withRepoDefaults({ harness: { provider: "omp", model: "first", from: "settings" } }, row(B, { provider: "omp" }), [native]).defaults.harness.model, "native", "explicit repository harness default uses native OMP even when Settings uses OMP");
assert.equal(repos.withRepoDefaults(settings, row(B, { provider: "omp", model: "override" }), [native]).defaults.harness.model, "override", "explicit repository model overrides native OMP");


// Filter: an explicit ?repo wins over the cookie; anything else shows every repo.
assert.equal(repoFilter(B, A), B, "the param wins");
assert.equal(repoFilter(undefined, A), A, "the cookie is remembered");
assert.equal(repoFilter("all", A), null, "all overrides a remembered repo");
assert.equal(repoFilter(undefined, "all"), null);
assert.equal(repoFilter("not a repo", A), A, "an invalid param falls back to the cookie");
assert.equal(repoFilter(["a/b", "c/d"], undefined), null, "a repeated param is ignored");
assert.equal(repoFilter(undefined, undefined), null);

// Owner-only saves with validation.
const saved: unknown[] = [];
const deps = (user: typeof owner | null = owner) => ({
  user: async () => user,
  registry: async () => registry,
  harnesses: async () => harnesses,
  save: async (choice: unknown) => void saved.push(choice),
});
const input = { repo: B, displayName: "Shop app", enabled: true, provider: "codex", autonomy: "trial", requireBugbot: true };
for (const user of [null, { email: "x@example.com", emailVerified: true }, { email: OWNER, emailVerified: false }]) {
  assert.equal((await repos.saveRepository(deps(user), input)).ok, false, `${user?.email ?? "signed out"} cannot save`);
  assert.deepEqual(await repos.makeDefaultRepo({ ...deps(user), save: async () => void saved.push("default") }, { repo: B }), {
    ok: false,
    status: 403,
    message: "Only the factory owner can change repositories.",
  });
}
assert.equal(saved.length, 0, "and nothing is saved");
const refused = async (over: Record<string, unknown>) => {
  const outcome = await repos.saveRepository(deps(), { ...input, ...over });
  return outcome.ok ? "saved" : `${outcome.status} ${outcome.message}`;
};
assert.equal(await refused({ repo: "nope" }), "400 Name the repo as owner/name.");
assert.equal(await refused({ repo: `${OWNER_NS}/unknown` }), `400 ${OWNER_NS}/unknown is not a registered repository.`);
assert.equal(await refused({ repo: A, displayName: "factory-demo", enabled: false }), "400 The default repository can't be disabled. Make another one the default first.");
assert.equal(await refused({ displayName: "Factory-Demo" }), `400 ${A} is already named Factory-Demo.`, "display names stay unique, since labels match by them");
assert.equal(await refused({ displayName: "a, b" }), "400 The name can't contain commas or line breaks.");
assert.equal(await refused({ provider: "off" }), "400 No machine reports an enabled harness off.");
for (const bad of [{ autonomy: "always" }, { enabled: "yes" }]) assert.match(await refused(bad), /^400 /, `${JSON.stringify(bad)} is refused`);
assert.equal(await refused({ requireBugbot: "no" }), "400 Say whether pull requests wait for Bugbot.", "Require Bugbot review is a yes or no");
assert.equal(await refused({ requireBugbot: undefined }), "400 Say whether pull requests wait for Bugbot.", "and must be sent");
assert.equal(saved.length, 0);
const kept = { ...deps(), registry: async () => registry.map((r) => (r.repo === B ? { ...r, provider: "gone" } : r)) };
assert.equal((await repos.saveRepository(kept, { ...input, provider: "gone", displayName: "Shop renamed" })).ok, true, "a stored harness no machine reports any more does not block other edits");
assert.equal((await repos.saveRepository(kept, { ...input, provider: "off" })).ok, false, "but changing to an unreported harness is still refused");
saved.length = 0;
assert.equal(await refused({}), "saved");
assert.equal(await refused({ provider: null }), "saved", "null means Settings");
assert.equal(await refused({ protectedPaths: [" "], maxChangedLines: 0 }), "saved", "a form from before protected paths and the size limit went away still saves");
assert.ok(!("protectedPaths" in (saved.at(-1) as object)) && !("maxChangedLines" in (saved.at(-1) as object)), "without them");
assert.equal(await refused({ requireBugbot: false }), "saved");
assert.equal((saved.at(-1) as { requireBugbot: boolean }).requireBugbot, false, "a repo without Bugbot saves as such");
assert.equal(await refused({ model: "gpt-second" }), "saved", "a reported repository model saves");
const savedModel = saved.at(-1);
assert.ok(savedModel && typeof savedModel === "object" && "model" in savedModel);
assert.equal(savedModel.model, "gpt-second");
assert.equal(await refused({ model: "claude-second" }), "400 Codex has no model claude-second.", "models belong to their harness");
assert.equal(await refused({ provider: null, model: "gpt-second" }), "400 Pick a repository harness before choosing its model.");
const keptModel = { ...deps(), registry: async () => registry.map((r) => r.repo === B ? { ...r, model: "gone" } : r) };
assert.equal((await repos.saveRepository(keptModel, { ...input, model: "gone", displayName: "Shop renamed" })).ok, true, "retaining an unavailable model does not block unrelated edits");
assert.equal((await repos.makeDefaultRepo({ ...deps(), save: async () => {} }, { repo: OFF })).ok, false, "a disabled repo cannot become the default");

// Removing a repository is owner-only, never the default, and only when it has no open jobs.
const removed: string[] = [];
const removeDeps = (over: Partial<Parameters<typeof repos.removeRepository>[0]> = {}) => ({
  user: async () => owner,
  registry: async () => registry,
  openJobs: async () => 0,
  remove: async (repo: string) => void removed.push(repo),
  ...over,
});
for (const user of [null, { email: "x@example.com", emailVerified: true }]) {
  assert.equal((await repos.removeRepository(removeDeps({ user: async () => user }), { repo: B })).ok, false, `${user?.email ?? "signed out"} cannot remove`);
}
assert.equal(removed.length, 0, "and nothing is removed");
const refusedRemoval = async (over: Partial<Parameters<typeof repos.removeRepository>[0]> = {}) => {
  const outcome = await repos.removeRepository(removeDeps(over), { repo: B });
  return outcome.ok ? "removed" : `${outcome.status} ${outcome.message}`;
};
assert.equal(await refusedRemoval({ registry: async () => registry.filter((r) => r.repo !== B) }), `400 ${B} is not a registered repository.`);
assert.equal(await refusedRemoval({ registry: async () => registry.map((r) => (r.repo === B ? { ...r, is_default: true } : r)) }), "400 The default repository can't be removed. Make another one the default first.");
assert.equal(await refusedRemoval({ openJobs: async () => 2 }), `400 ${B} has 2 open jobs. Close or archive them before removing it.`);
assert.equal(removed.length, 0);
assert.equal(await refusedRemoval(), "removed");
assert.deepEqual(removed, [B]);
assert.equal((await repos.makeDefaultRepo({ ...deps(), save: async () => {} }, { repo: B })).ok, true);

// New job: the issue always gets its Repository label, the default one when none is picked.
const filed: Parameters<NewJobDeps["file"]>[0][] = [];
const fileDeps: NewJobDeps = { user: async () => owner, file: async (d) => (filed.push(d), { key: "JOB-1", url: "/jobs/JOB-1" }), harnesses: async () => harnesses, registry: async () => registry };
const requestId = "6f0c3f8e-1f4b-4a52-9f0e-2d7c5a8b9c12";
await createJob(fileDeps, { title: "Title", description: "", requestId });
assert.equal(filed[0]!.repo, A, "default repository identity is stored directly");
await createJob(fileDeps, { title: "Title", description: "", requestId, repo: B });
assert.equal(filed[1]!.repo, B, "an explicit repository overrides the default");
assert.equal((await createJob(fileDeps, { title: "Title", description: "", requestId, repo: OFF })).ok, false, "a disabled repo is refused");
assert.equal((await createJob(fileDeps, { title: "Title", description: "", requestId, repo: `${OWNER_NS}/nope` })).ok, false, "an unknown repo is refused");


// The database keeps one default, and it must be enabled; a move happens in one transaction.
const original = await db.select().from(repoSettings);
const originalDefault = original.find((r) => r.is_default)?.repo ?? null;
const code = (error: unknown) => (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
try {
  await db.insert(repoSettings).values([A, B, OFF].map((repo) => ({ repo, updated_at: new Date(), updated_by: "test", enabled: repo !== OFF })));
  await repos.writeDefaultRepo(db, A, "test", new Date());
  const defaults = async () => (await db.select().from(repoSettings).where(eq(repoSettings.is_default, true))).map((r) => r.repo);
  assert.deepEqual(await defaults(), [A], "the default moved");
  await assert.rejects(db.update(repoSettings).set({ is_default: true }).where(eq(repoSettings.repo, B)), (e) => code(e) === "23505", "a second default is refused");
  await assert.rejects(db.update(repoSettings).set({ enabled: false }).where(eq(repoSettings.repo, A)), (e) => code(e) === "23514", "the default cannot be disabled");
  await assert.rejects(repos.writeDefaultRepo(db, OFF, "test", new Date()), /not an enabled repository/);
  assert.deepEqual(await defaults(), [A], "and a refused move leaves the default where it was");
  await repos.writeDefaultRepo(db, B, "test", new Date());
  assert.deepEqual(await defaults(), [B]);

  await repos.registerRepos(db, [`${OWNER_NS}/new`], "runner", new Date());
  assert.deepEqual(await defaults(), [B], "registering a checkout never moves an existing default");
  await db.update(repoSettings).set({ is_default: false }).where(eq(repoSettings.is_default, true));
  await repos.registerRepos(db, [`${OWNER_NS}/fresh`, `${OWNER_NS}/second`], "runner", new Date());
  assert.deepEqual(await defaults(), [`${OWNER_NS}/fresh`], "with no default, the first checkout becomes it");

  // Two checkouts with the same name part: the second registers under its full name, so a label names one repo.
  const dupA = `${OWNER_NS}/dup-${stamp}`;
  const dupB = `${OWNER_NS}-other/dup-${stamp}`;
  await repos.registerRepos(db, [dupA, dupB], "runner", new Date());
  const dupRows = await db.select().from(repoSettings).where(inArray(repoSettings.repo, [dupA, dupB]));
  assert.deepEqual(dupRows.map((r) => [r.repo, r.display_name]).sort(), [[dupA, null], [dupB, dupB]].sort(), "the second repo with a taken name is named by its full name");

  const removable = `${OWNER_NS}/removable`;
  const intentId = `repository:test-${stamp}`;
  await db.insert(repoSettings).values({ repo: removable, updated_at: new Date(), updated_by: "test" });
  await db.insert(intents).values({ id: intentId, kind: "onboard_repo", detail: JSON.stringify({ repo: removable, actor: OWNER }), created_at: new Date() });
  await repos.deleteRepository(db, removable);
  assert.equal((await db.select().from(repoSettings).where(eq(repoSettings.repo, removable))).length, 0, "removal deletes the registry row");
  assert.equal((await db.select().from(intents).where(eq(intents.id, intentId))).length, 0, "and its pending registration");

  await repos.writeRepository(db, { repo: B, displayName: "shop", enabled: true, provider: "codex", model: "gpt-second", autonomy: "trial", requireBugbot: false }, OWNER, new Date());
  const [shopRow] = await db.select().from(repoSettings).where(eq(repoSettings.repo, B));
  assert.deepEqual([shopRow!.display_name, shopRow!.autonomy, shopRow!.require_bugbot, shopRow!.model], [null, "trial", false, "gpt-second"], "repository model persists with its settings");


  console.log("repositories regressions passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  const ours = like(jobs.key, `${OWNER_NS}-%`);
  const ids = (await db.select({ id: jobs.id }).from(jobs).where(ours)).map((j) => j.id);
  if (ids.length > 0) await db.delete(auditLog).where(inArray(auditLog.job_id, ids));
  await db.delete(jobs).where(ours);
  await db.delete(repoSettings).where(like(repoSettings.repo, `${OWNER_NS}%/%`));
  if (originalDefault) await repos.writeDefaultRepo(db, originalDefault, "test", new Date());
  process.exit(process.exitCode ?? 0);
}
