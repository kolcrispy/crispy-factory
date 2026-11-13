import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type * as schema from "@factory/storage/schema";
import { intents, repoSettings } from "@factory/storage/schema";
import { REPO_NAME } from "./repo-name";

const inputSchema = z.object({ requestId: z.uuid(), repo: z.string().trim().min(1), checkout: z.string().trim().min(1).optional() });
type Database = NodePgDatabase<typeof schema>;

export function repositoryName(value: string) {
  let name = value.trim();
  if (name.startsWith("https://")) {
    const url = new URL(name);
    if (url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) throw new Error("Use a GitHub repository URL or owner/repo.");
    name = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  name = name.replace(/\.git$/, "");
  if (!REPO_NAME.test(name) || name.split("/").some(part => part === "." || part === "..")) throw new Error("Name the repository as owner/repo or its GitHub URL.");
  return name.toLowerCase();
}

/** Remote callers submit names only; an existing checkout may be supplied by the trusted local CLI. */
export async function requestRepository(database: Database, input: unknown, actor: string) {
  const parsed = inputSchema.parse(input);
  const repo = repositoryName(parsed.repo);
  if (!actor.trim()) throw new Error("A repository request requires an audit actor.");
  const id = `repository:${parsed.requestId}`;
  const detail = JSON.stringify({ repo, actor, ...(parsed.checkout && { checkout: parsed.checkout }) });
  return database.transaction(async tx => {
    const inserted = await tx.insert(intents).values({ id, kind: "onboard_repo", detail, created_at: new Date() }).onConflictDoNothing().returning();
    if (!inserted.length) {
      const [existing] = await tx.select().from(intents).where(eq(intents.id, id));
      if (existing?.detail !== detail) throw new Error("This request ID belongs to another repository registration.");
      return { intentId: id, repo };
    }
    const now = new Date();
    await tx.insert(repoSettings).values({ repo, enabled: true, updated_at: now, updated_by: actor }).onConflictDoNothing();
    await tx.update(repoSettings).set({ registration_status: "pending", registration_error: null, updated_at: now, updated_by: actor }).where(eq(repoSettings.repo, repo));
    return { intentId: id, repo };
  });
}
