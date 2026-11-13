import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@factory/storage/client";
import { repoSettings } from "@factory/storage/schema";
import { exec } from "@factory/platform/exec";
import { ghRequest } from "@factory/integrations/github/gh";
import { repositoryName } from "@factory/core/repository-registration";
import { parseRecipe, RECIPE_PATH, type Recipe } from "@factory/core/recipe";

const registration = z.object({ repo: z.string(), actor: z.string().min(1), checkout: z.string().min(1).optional() });
const metadata = z.object({ full_name: z.string(), default_branch: z.string().min(1), archived: z.boolean(), permissions: z.object({ push: z.boolean() }) });

export const repositoryRuntime = { request: ghRequest, run: exec };

/** Existing checkouts are inspected, never reset, cleaned, or replaced. */
export async function prepareRepository(detail: string, workRoot: string) {
  const request = registration.parse(JSON.parse(detail));
  const repo = repositoryName(request.repo);
  try {
    const remote = metadata.parse((await repositoryRuntime.request("GET", `/repos/${repo}`)).json);
    if (remote.archived || !remote.permissions.push) throw new Error("Repository is archived or the gh account lacks push access.");
    if (repositoryName(remote.full_name) !== repo) throw new Error("Repository was renamed; register its current GitHub name.");
    const checkout = request.checkout ? resolve(request.checkout) : join(resolve(workRoot), ...repo.split("/"));
    if (!existsSync(checkout)) {
      if (request.checkout) throw new Error("The supplied local checkout does not exist.");
      const parent = join(resolve(workRoot), repo.split("/")[0]!);
      mkdirSync(parent, { recursive: true });
      const temporary = mkdtempSync(join(parent, ".factory-clone-"));
      try {
        await repositoryRuntime.run("gh", ["repo", "clone", repo, temporary], { timeoutMs: 300_000 });
        renameSync(temporary, checkout);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
    const origin = (await repositoryRuntime.run("git", ["remote", "get-url", "origin"], { cwd: checkout, timeoutMs: 10_000 })).stdout.trim();
    const normalized = origin.replace(/^git@github\.com:/, "https://github.com/").replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
    if (repositoryName(normalized) !== repo) throw new Error("Local checkout origin does not match the requested GitHub repository.");
    await repositoryRuntime.run("git", ["rev-parse", "--verify", `refs/remotes/origin/${remote.default_branch}`], { cwd: checkout, timeoutMs: 10_000 });
    const recipeFile = await repositoryRuntime.run("git", ["ls-tree", "--name-only", `refs/remotes/origin/${remote.default_branch}`, "--", RECIPE_PATH], { cwd: checkout, timeoutMs: 10_000 });
    let recipe: Recipe | null = null;
    if (recipeFile.stdout.trim() === RECIPE_PATH) {
      const content = await repositoryRuntime.run("git", ["show", `refs/remotes/origin/${remote.default_branch}:${RECIPE_PATH}`], { cwd: checkout, timeoutMs: 10_000 });
      const parsed = parseRecipe(content.stdout);
      if (!parsed.ok) throw new Error(parsed.error);
      recipe = parsed.recipe;
    }
    await db.update(repoSettings).set({ registration_status: "ready", registration_error: null, checkout_path: checkout, default_branch: remote.default_branch, recipe, updated_at: new Date(), updated_by: request.actor }).where(eq(repoSettings.repo, repo));
    return { repo, checkout, status: "ready" as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db.update(repoSettings).set({ registration_status: "failed", registration_error: reason, updated_at: new Date() }).where(eq(repoSettings.repo, repo));
    throw error;
  }
}
