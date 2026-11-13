import { isOwner, type SessionUser } from "./auth/owner";
import type { Harness } from "./harness";
import { JOB_IMAGE_TYPES, MAX_JOB_IMAGE_BYTES, newJobSchema, type ImageUploadOutcome, type NewJobOutcome } from "./new-job-schema";
import type { FiledJob, ImageFile } from "./sources/types";
import { defaultRepo, type Registry } from "./repositories";

// Dashboard and CLI submissions commit directly to the shared job queue.

export type NewJobDeps = {
  user: () => Promise<SessionUser | null | undefined>;
  file: (draft: { requestId: string; title: string; description: string; repo: string; provider?: string }, actor: string) => Promise<FiledJob>;
  /** What the machines report; null when none has reported its harnesses yet. */
  harnesses: () => Promise<Harness[] | null>;
  registry: () => Promise<Registry>;
};

export async function createJob(deps: NewJobDeps, input: unknown): Promise<NewJobOutcome> {
  const owner = await deps.user();
  if (!isOwner(owner)) return { ok: false, status: 403, message: "Only the factory owner can start jobs." };
  const parsed = newJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, message: parsed.error.issues[0]?.message ?? "The job is not valid." };
  const { provider, repo, ...draft } = parsed.data;
  const registry = await deps.registry();
  const target = repo ? registry.find((r) => r.repo === repo) : defaultRepo(registry);
  if (!target?.enabled) return { ok: false, status: 400, message: "Choose an enabled repository before starting a job." };
  if (provider) {
    const harness = (await deps.harnesses())?.find((h) => h.id === provider && h.enabled);
    if (!harness) return { ok: false, status: 400, message: `No machine reports an enabled harness ${provider}.` };
    // Provider availability is checked against the runner's reported inventory.
  }
  try {
    const filed = await deps.file({ ...draft, repo: target.repo, provider }, owner!.email);
    return { ok: true, identifier: filed.key, url: filed.url };
  } catch (error) {
    return { ok: false, status: 502, message: `Could not file the job: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export type ImageUploadDeps = {
  user: () => Promise<SessionUser | null | undefined>;
  upload: (image: ImageFile) => Promise<string>;
};

/** Stores an image for a job the owner is about to file; the form puts the returned markdown in the description. */
export async function uploadJobImage(deps: ImageUploadDeps, file: File | null): Promise<ImageUploadOutcome> {
  if (!isOwner(await deps.user())) return { ok: false, status: 403, message: "Only the factory owner can add images." };
  if (!file) return { ok: false, status: 400, message: "No image was sent." };
  if (!(JOB_IMAGE_TYPES as readonly string[]).includes(file.type)) return { ok: false, status: 400, message: `${file.name} is not a PNG, JPEG, WebP or GIF image.` };
  if (file.size > MAX_JOB_IMAGE_BYTES) return { ok: false, status: 413, message: `${file.name} is larger than 4 MB.` };
  try {
    const markdown = await deps.upload({ filename: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return { ok: true, markdown };
  } catch (error) {
    return { ok: false, status: 502, message: `Could not upload ${file.name}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
