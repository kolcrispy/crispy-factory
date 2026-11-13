import { eq } from "drizzle-orm";
import { getOwner } from "../../../../../lib/auth/server";
import { isOwner } from "@factory/core/auth/owner";
import { db } from "@factory/storage/client";
import { jobImages } from "@factory/storage/schema";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isOwner(await getOwner())) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const [image] = await db.select().from(jobImages).where(eq(jobImages.id, id));
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
