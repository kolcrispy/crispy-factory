import "./test-guard";
import assert from "node:assert/strict";
import { trustedOperator } from "@factory/core/auth/owner";
import type { NewJobDeps } from "@factory/core/new-job";
import type { Registry } from "@factory/core/repositories";

const OWNER = "owner@example.com";
process.env.FACTORY_OWNER_EMAILS = OWNER;

const { createJob, uploadJobImage } = await import("@factory/core/new-job");

const owner = { email: OWNER, emailVerified: true };
const requestId = "6f0c3f8e-1f4b-4a52-9f0e-2d7c5a8b9c10";
const harnesses = async () => null;
const registry = async (): Promise<Registry> => [{
  repo: "owner/repo", registration_status: "ready", registration_error: null,
  checkout_path: null, default_branch: "main", display_name: null, is_default: true,
  enabled: true, provider: null, model: null, autonomy: "off", protected_paths: null,
  max_changed_lines: null, require_bugbot: false, recipe: null, updated_at: new Date(0), updated_by: OWNER,
}];
const draft = { title: "Show the item count", description: "On the weight sort button.", requestId };

{
  const filed: Parameters<NewJobDeps["file"]>[0][] = [];
  const actors: string[] = [];
  const file: NewJobDeps["file"] = async (d, actor) => (filed.push(d), actors.push(actor), { key: "JOB-99", url: "/jobs/JOB-99" });
  for (const user of [null, { email: "someone@example.com", emailVerified: true }, { email: OWNER, emailVerified: false }]) {
    const outcome = await createJob({ user: async () => user, file, harnesses, registry }, draft);
    assert.deepEqual([outcome.ok, !outcome.ok && outcome.status], [false, 403], `a non-owner (${user?.email ?? "signed out"}) cannot start a job`);
  }
  assert.equal(filed.length, 0, "and nothing is filed");

  const tooShort = await createJob({ user: async () => owner, file, harnesses, registry }, { ...draft, title: " a " });
  assert.equal(!tooShort.ok && tooShort.status, 400, "a title under 3 characters is refused");
  const noRequest = await createJob({ user: async () => owner, file, harnesses, registry }, { ...draft, requestId: "not-a-uuid" });
  assert.equal(!noRequest.ok && noRequest.status, 400, "a request without a request id is refused");
  assert.equal(filed.length, 0);

  const ok = await createJob({ user: async () => owner, file, harnesses, registry }, { ...draft, title: "  Show the item count  " });
  assert.deepEqual(ok, { ok: true, identifier: "JOB-99", url: "/jobs/JOB-99" }, "the owner files an internal job");
  assert.deepEqual(filed[0], { ...draft, title: "Show the item count", repo: "owner/repo", provider: undefined }, "the selected repository and trimmed draft reach shared storage");
  assert.deepEqual(actors, [OWNER], "the authenticated actor accompanies the submission");

  const down = await createJob({ user: async () => owner, file: async () => Promise.reject(new Error("PostgreSQL is down")), harnesses, registry }, draft);
  assert.equal(!down.ok && down.status, 502, "a storage failure is reported");
  assert.match(!down.ok ? down.message : "", /PostgreSQL is down/);

  const allowlist = process.env.FACTORY_OWNER_EMAILS;
  process.env.FACTORY_OWNER_EMAILS = "";
  try {
    const user = trustedOperator("local:job-submitter");
    const submitted = await createJob({ user: async () => user, file, harnesses, registry }, draft);
    assert.equal(submitted.ok, true, "trusted CLI submission requires no dashboard account");
    const spoofed = await createJob({ user: async () => ({ ...user }), file, harnesses, registry }, draft);
    assert.equal(!spoofed.ok && spoofed.status, 403, "browser input cannot forge the trusted operator identity");
  } finally {
    if (allowlist === undefined) delete process.env.FACTORY_OWNER_EMAILS; else process.env.FACTORY_OWNER_EMAILS = allowlist;
  }
}


{
  const uploaded: string[] = [];
  const upload = async (image: { filename: string }) => (uploaded.push(image.filename), `![${image.filename}](/api/jobs/images/image-id)`);
  const png = (name: string, size = 10, type = "image/png") => new File([new Uint8Array(size)], name, { type });

  const stranger = await uploadJobImage({ user: async () => ({ email: "someone@example.com", emailVerified: true }), upload }, png("a.png"));
  assert.equal(!stranger.ok && stranger.status, 403, "a non-owner cannot upload images");
  const pdf = await uploadJobImage({ user: async () => owner, upload }, png("spec.pdf", 10, "application/pdf"));
  assert.equal(!pdf.ok && pdf.status, 400, "a file that is not an image is refused");
  const big = await uploadJobImage({ user: async () => owner, upload }, png("big.png", 4 * 1024 * 1024 + 1));
  assert.equal(!big.ok && big.status, 413, "an image over 4 MB is refused, under Vercel's request limit");
  const none = await uploadJobImage({ user: async () => owner, upload }, null);
  assert.equal(!none.ok && none.status, 400, "a request without a file is refused");
  assert.deepEqual(uploaded, [], "rejected requests never reach image storage");
  assert.deepEqual(
    await uploadJobImage({ user: async () => owner, upload }, png("screen.png")),
    { ok: true, markdown: "![screen.png](/api/jobs/images/image-id)" },
    "the owner's image comes back as markdown for the description",
  );
}


console.log("new job regressions passed");
