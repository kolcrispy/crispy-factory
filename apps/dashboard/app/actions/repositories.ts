"use server";

import { randomUUID } from "node:crypto";
import { db } from "@factory/storage/client";
import { machines } from "@factory/storage/schema";
import { getOwner } from "../../lib/auth/server";
import { isOwner } from "@factory/core/auth/owner";
import { reportedHarnesses } from "@factory/core/machine";
import { requestRepository } from "@factory/core/repository-registration";
import { makeDefaultRepo, readRegistry, saveRepository as save, writeDefaultRepo, writeRepository, type DefaultRepoInput, type RepositoryInput } from "@factory/core/repositories";

const user = getOwner;
const registry = () => readRegistry(db);

export async function saveRepository(input: RepositoryInput) {
  return save({ user, registry, harnesses: async () => reportedHarnesses(await db.select().from(machines), Date.now()), save: (choice, by) => writeRepository(db, choice, by, new Date()) }, input);
}

export async function makeDefaultRepository(input: DefaultRepoInput) {
  return makeDefaultRepo({ user, registry, save: (repo, by) => writeDefaultRepo(db, repo, by, new Date()) }, input);
}

export async function addRepository(input: { repo: string; requestId: string }) {
  const owner = await getOwner();
  if (!isOwner(owner)) return { ok: false as const, message: "Only the factory owner can register repositories." };
  try {
    const accepted = await requestRepository(db, { repo: input.repo, requestId: input.requestId }, owner!.email);
    return { ok: true as const, ...accepted };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function retryRegistration(input: { repo: string }) {
  return addRepository({ repo: input.repo, requestId: randomUUID() });
}
