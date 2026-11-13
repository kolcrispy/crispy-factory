import { randomUUID } from "node:crypto";
import { getOwner } from "../../../../lib/auth/server";
import { db } from "@factory/storage/client";
import { jobImages } from "@factory/storage/schema";
import { uploadJobImage } from "@factory/core/new-job";

/** Binary input images live in shared PostgreSQL, not an external issue service. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  const owner = await getOwner();
  const outcome = await uploadJobImage({
    user: async () => owner,
    upload: async image => {
      const id = randomUUID();
      await db.insert(jobImages).values({ id, filename: image.filename, content_type: image.contentType, bytes: Buffer.from(image.bytes), uploaded_by: owner!.email });
      return `![${image.filename.replace(/[\[\]\r\n]/g, "_")}](/api/jobs/images/${id})`;
    },
  }, file instanceof File ? file : null);
  return Response.json(outcome, { status: outcome.ok ? 200 : outcome.status });
}
