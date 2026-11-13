import { resolve } from "node:path";
import type { JobHost } from "./host";

/** Where a repo may keep its own copy, as scripts/install-target.ts writes it. */
export const REPO_PLAYBOOK = ".agents/playbooks/factory.md";

/** The factory playbook's absolute path on the runner machine. */
export function factoryPlaybook() {
  return resolve(import.meta.dirname, "../../../playbooks/factory.md");
}

/** Whether the repo's main has its own copy; any failure to tell counts as none. */
export async function repoHasPlaybook(host: JobHost, checkout: string) {
  try {
    await host.run("git", ["-C", checkout, "cat-file", "-e", `origin/main:${REPO_PLAYBOOK}`], { timeoutMs: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/** The launch message's last section: which playbook to follow, and how a repo copy ranks against it. */
export function playbookSection(repoCopy: boolean) {
  const path = factoryPlaybook();
  return [
    "## Factory playbook",
    "",
    `The factory playbook is ${path}. Read it before anything else and follow it. It lives outside this repository and extends PStack's bundled playbooks the way a project playbook under .agents/playbooks/ does: copy the bundled steps, then apply its changes.`,
    ...(repoCopy
      ? [
          "",
          `This repository also has ${REPO_PLAYBOOK}. The factory playbook at ${path} is authoritative: where they differ, follow it. Take the repository copy only for notes specific to this repository.`,
        ]
      : []),
  ].join("\n");
}

/** A launch message with its playbook section, for a thread on this host in this checkout of the repo. */
export async function withPlaybook(message: string, host: JobHost, checkout: string) {
  return `${message}\n\n${playbookSection(await repoHasPlaybook(host, checkout))}`;
}
