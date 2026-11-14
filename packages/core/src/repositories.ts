import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type * as schema from "@factory/storage/schema";
import { intents, jobs, repoSettings, type RepoSettingsRow } from "@factory/storage/schema";
import { isOwner, type SessionUser } from "./auth/owner";
import type { Harness } from "./harness";
import { autonomySchema } from "./merge-decision";
import { displayName, REPO_NAME, repoName } from "./repo-name";
import type { EffectiveHarness, SettingsOutcome } from "./settings";
import { reviewOverridesSchema } from "./review";

// Internal submissions select a registered repository directly, falling back to its default.

type Db = NodePgDatabase<typeof schema>;
export type Registry = readonly RepoSettingsRow[];

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const defaultRepo = (registry: Registry) => registry.find((r) => r.is_default) ?? null;


export type LaunchDefaults = { harness: EffectiveHarness };

/** Repository harness/model overrides Settings; unavailable choices fall back with a problem. */
export function withRepoDefaults(settings: LaunchDefaults, repo: RepoSettingsRow | undefined, harnesses: readonly Harness[] | null) {
  const problems: string[] = [];
  let harness = settings.harness;
  if (repo?.provider) {
    const selected = harnesses?.find((h) => h.id === repo.provider && h.enabled);
    if (!repo.model && !selected?.defaultModel && repo.provider === settings.harness.provider) return { defaults: { harness }, problems };
    const model = repo.model ?? selected?.defaultModel ?? selected?.models[0]?.slug;
    if (model && selected?.models.some((candidate) => candidate.slug === model)) {
      harness = { provider: repo.provider, model, from: "repo" };
    } else {
      problems.push(`${repo.repo} defaults to harness ${repo.provider}${repo.model ? ` and model ${repo.model}` : ""}, which no runner reports available, so its jobs start on the Settings harness.`);
    }
  }
  return { defaults: { harness }, problems };
}

export const readRegistry = (database: Db): Promise<RepoSettingsRow[]> => database.select().from(repoSettings).orderBy(asc(repoSettings.repo));

/** Per repo, its jobs that are not merged or failed, and when its newest job was claimed. */
export type RepoStats = { repo: string; open: number; lastAt: Date | null };

export const readRepoStats = (database: Db): Promise<RepoStats[]> =>
  database
    .select({
      repo: jobs.repo,
      open: sql<number>`(count(*) filter (where ${jobs.stage} not in ('merged', 'failed')))::int`,
      lastAt: sql<Date | null>`max(${jobs.claimed_at})`.mapWith(jobs.claimed_at),
    })
    .from(jobs)
    .groupBy(jobs.repo);

const isUniqueViolation = (error: unknown) => (error as { code?: string; cause?: { code?: string } })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505";

/**
 * Adds the runner's checkouts to the registry and makes the first one the default when none is.
 * It never changes a row that exists, so the panel's edits win. A new repo whose name part another
 * repo already goes by is named by its full name, since labels match by display name.
 */
export async function registerRepos(database: Db, repos: readonly string[], by: string, at: Date) {
  if (repos.length === 0) return;
  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('repo_settings.display_name'))`);
    const named: Pick<RepoSettingsRow, "repo" | "display_name">[] = await tx.select({ repo: repoSettings.repo, display_name: repoSettings.display_name }).from(repoSettings);
    const added: (typeof repoSettings.$inferInsert)[] = [];
    for (const repo of repos) {
      if (named.some((r) => r.repo === repo)) continue;
      const display_name = named.some((r) => same(displayName(r), repoName(repo)) || same(r.repo, repoName(repo))) ? repo : null;
      named.push({ repo, display_name });
      added.push({ repo, display_name, updated_at: at, updated_by: by });
    }
    if (added.length > 0) await tx.insert(repoSettings).values(added).onConflictDoNothing();
  });
  try {
    await database.execute(
      sql`update ${repoSettings} set is_default = true where repo = ${repos[0]} and enabled and not exists (select 1 from ${repoSettings} where is_default)`,
    );
  } catch (error) {
    // Another runner made its first repo the default in between; one default is all that is wanted.
    if (!isUniqueViolation(error)) throw error;
  }
}

/** Moves the default to `repo` in one transaction, so there is never a moment with two. */
export async function writeDefaultRepo(database: Db, repo: string, by: string, at: Date) {
  await database.transaction(async (tx) => {
    await tx.update(repoSettings).set({ is_default: false }).where(sql`${repoSettings.is_default} and ${repoSettings.repo} <> ${repo}`);
    const [moved] = await tx
      .update(repoSettings)
      .set({ is_default: true, updated_at: at, updated_by: by })
      .where(sql`${repoSettings.repo} = ${repo} and ${repoSettings.enabled}`)
      .returning({ repo: repoSettings.repo });
    if (!moved) throw new Error(`${repo} is not an enabled repository`);
  });
}


export const repositoryInputSchema = z.object({
  repo: z.string().regex(REPO_NAME, "Name the repo as owner/name."),
  displayName: z
    .string()
    .trim()
    .min(1, "Give the repository a name.")
    .max(60, "Keep the name under 60 characters.")
    .regex(/^[^,\n]+$/, "The name can't contain commas or line breaks."),
  enabled: z.boolean(),
  /** A harness's provider instance id; null means Settings decide. */
  provider: z.string().trim().min(1).nullable(),
  /** Model overrides belong to an explicit harness; null inherits its default. */
  model: z.string().trim().min(1).nullable().default(null),
  review: reviewOverridesSchema.optional(),
  autonomy: autonomySchema,
  requireBugbot: z.boolean({ error: "Say whether pull requests wait for Bugbot." }),
});
export type RepositoryInput = z.input<typeof repositoryInputSchema>;
export type RepositoryChoice = z.output<typeof repositoryInputSchema>;

export const defaultRepoInputSchema = z.object({ repo: z.string().regex(REPO_NAME, "Name the repo as owner/name.") });
export type DefaultRepoInput = z.input<typeof defaultRepoInputSchema>;

export async function writeRepository(database: Db, choice: RepositoryChoice, by: string, at: Date) {
  const updated = await database
    .update(repoSettings)
    .set({
      display_name: same(choice.displayName, repoName(choice.repo)) ? null : choice.displayName,
      enabled: choice.enabled,
      provider: choice.provider,
      model: choice.model,
      ...(choice.review !== undefined && { review: choice.review }),
      autonomy: choice.autonomy,
      require_bugbot: choice.requireBugbot,
      updated_at: at,
      updated_by: by,
    })
    .where(eq(repoSettings.repo, choice.repo))
    .returning({ repo: repoSettings.repo });
  if (updated.length === 0) throw new Error(`${choice.repo} is not in the registry`);
}

export type RepositoryDeps = {
  user: () => Promise<SessionUser | null | undefined>;
  registry: () => Promise<Registry>;
  /** What the machines report; null when none has reported its harnesses yet. */
  harnesses: () => Promise<Harness[] | null>;
  save: (choice: RepositoryChoice, by: string) => Promise<void>;
};

const FORBIDDEN = { ok: false, status: 403, message: "Only the factory owner can change repositories." } as const;
const invalid = (message: string): SettingsOutcome => ({ ok: false, status: 400, message });
const failed = (error: unknown): SettingsOutcome => ({
  ok: false,
  status: 502,
  message: `Could not save the repository: ${error instanceof Error ? error.message : String(error)}`,
});

/** Edits one registered repo. The default stays enabled, and display names stay unique, since labels match by them. */
export async function saveRepository(deps: RepositoryDeps, input: unknown): Promise<SettingsOutcome> {
  const user = await deps.user();
  if (!user || !isOwner(user)) return FORBIDDEN;
  const parsed = repositoryInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "The repository is not valid.");
  const choice = parsed.data;
  const registry = await deps.registry();
  const row = registry.find((r) => r.repo === choice.repo);
  if (!row) return invalid(`${choice.repo} is not a registered repository.`);
  if (row.is_default && !choice.enabled) return invalid("The default repository can't be disabled. Make another one the default first.");
  const taken = registry.find((r) => r.repo !== choice.repo && (same(displayName(r), choice.displayName) || same(r.repo, choice.displayName)));
  if (taken) return invalid(`${taken.repo} is already named ${choice.displayName}.`);
  if (choice.model && !choice.provider) return invalid("Pick a repository harness before choosing its model.");
  if (choice.model && (choice.model !== row.model || choice.provider !== row.provider)) {
    const harness = (await deps.harnesses())?.find((h) => h.id === choice.provider && h.enabled);
    if (!harness) return invalid(`No machine reports an enabled harness ${choice.provider}.`);
    if (!harness.models.some((m) => m.slug === choice.model)) return invalid(`${harness.name} has no model ${choice.model}.`);
  }
  // Only a changed harness is checked: one kept from before may no longer be reported, and other edits must still save.
  if (choice.provider && choice.provider !== row.provider) {
    const harnesses = await deps.harnesses();
    if (harnesses && !harnesses.some((h) => h.id === choice.provider && h.enabled)) return invalid(`No machine reports an enabled harness ${choice.provider}.`);
  }
  try {
    await deps.save(choice, user.email);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** Unregisters a repo; its local checkout and past jobs stay on disk and in the log. */
export async function deleteRepository(database: Db, repo: string) {
  await database.transaction(async (tx) => {
    await tx
      .delete(intents)
      .where(and(eq(intents.kind, "onboard_repo"), isNull(intents.handled_at), sql`${intents.detail}::jsonb->>'repo' = ${repo}`));
    await tx.delete(repoSettings).where(eq(repoSettings.repo, repo));
  });
}

export type RemoveRepoDeps = {
  user: () => Promise<SessionUser | null | undefined>;
  registry: () => Promise<Registry>;
  /** Jobs that are not merged or failed; removing their repo would leave the runner without it. */
  openJobs: (repo: string) => Promise<number>;
  remove: (repo: string) => Promise<void>;
};

/** Removes one non-default repo from the dashboard. The local checkout is not deleted. */
export async function removeRepository(deps: RemoveRepoDeps, input: unknown): Promise<SettingsOutcome> {
  const user = await deps.user();
  if (!user || !isOwner(user)) return FORBIDDEN;
  const parsed = defaultRepoInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "The repository is not valid.");
  const repo = parsed.data.repo;
  const row = (await deps.registry()).find((r) => r.repo === repo);
  if (!row) return invalid(`${repo} is not a registered repository.`);
  if (row.is_default) return invalid("The default repository can't be removed. Make another one the default first.");
  const open = await deps.openJobs(repo);
  if (open > 0) return invalid(`${repo} has ${open} open ${open === 1 ? "job" : "jobs"}. Close or archive them before removing it.`);
  try {
    await deps.remove(repo);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export type DefaultRepoDeps = {
  user: () => Promise<SessionUser | null | undefined>;
  registry: () => Promise<Registry>;
  save: (repo: string, by: string) => Promise<void>;
};

export async function makeDefaultRepo(deps: DefaultRepoDeps, input: unknown): Promise<SettingsOutcome> {
  const user = await deps.user();
  if (!user || !isOwner(user)) return FORBIDDEN;
  const parsed = defaultRepoInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "The repository is not valid.");
  const row = (await deps.registry()).find((r) => r.repo === parsed.data.repo);
  if (!row) return invalid(`${parsed.data.repo} is not a registered repository.`);
  if (!row.enabled) return invalid(`${row.repo} is disabled. Enable it before making it the default.`);
  try {
    await deps.save(row.repo, user.email);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
