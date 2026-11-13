"use server";

import { db } from "@factory/storage/client";
import { machines } from "@factory/storage/schema";
import { auth } from "../../lib/auth/server";
import { installationRepos } from "@factory/integrations/github/installation";
import { reportedHarnesses } from "@factory/core/machine";
import { modalEnvConfigured, modalSecretStore } from "@factory/integrations/modal-secrets";
import {
  addRepository as add,
  listAddable,
  rebuildRepoImage as rebuild,
  recordSecretNames,
  retryOnboarding as retry,
  saveRepoSecrets as saveSecrets,
  writeNewRepository,
  writeRepoRequest,
  repositoryRequest,
  type SecretsInput,
} from "@factory/core/repo-onboarding";
import {
  makeDefaultRepo,
  readRegistry,
  saveRepository as save,
  writeDefaultRepo,
  writeRepository,
  type DefaultRepoInput,
  type RepositoryInput,
} from "@factory/core/repositories";
import { panelSource } from "@factory/core/sources/index";

const user = async () => (await auth.getSession()).data?.user;
const registry = () => readRegistry(db);
const installable = () => installationRepos();
const request = (kind: "onboard_repo" | "rebuild_repo_image", repo: string, requestId: string) => writeRepoRequest(db, kind, repo, new Date(), requestId);
const replay = (kind: "onboard_repo" | "rebuild_repo_image", repo: string, requestId: string) => repositoryRequest(db, kind, repo, requestId);

export async function saveRepository(input: RepositoryInput) {
  return save(
    {
      user,
      registry,
      harnesses: async () => reportedHarnesses(await db.select().from(machines), Date.now()),
      save: (choice, by) => writeRepository(db, choice, by, new Date()),
    },
    input,
  );
}

export async function makeDefaultRepository(input: DefaultRepoInput) {
  return makeDefaultRepo({ user, registry, save: (repo, by) => writeDefaultRepo(db, repo, by, new Date()) }, input);
}

export async function addableRepositories() {
  return listAddable({ user, registry, installable });
}

export async function addRepository(input: { repo: string }) {
  return add({ user, registry, installable, replay, create: (repo, by, requestId) => writeNewRepository(db, repo, by, new Date(), requestId), syncLabels: (groups) => panelSource().panelSyncLabelGroups!(groups) }, input);
}

export async function saveRepositorySecrets(input: SecretsInput) {
  return saveSecrets(
    {
      user,
      registry,
      modalConfigured: () => modalEnvConfigured(),
      upsert: (name, entries) => modalSecretStore().upsert(name, entries),
      recordNames: (repo, names) => recordSecretNames(db, repo, names, new Date()),
    },
    input,
  );
}

export async function retryOnboarding(input: { repo: string }) {
  return retry({ user, registry, request, replay }, input);
}

export async function rebuildRepositoryImage(input: { repo: string }) {
  return rebuild({ user, registry, request, replay }, input);
}
