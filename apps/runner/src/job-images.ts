import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@factory/storage/client";
import { jobImages } from "@factory/storage/schema";

/** Agent sessions read input images locally without needing dashboard owner cookies. */
export async function localizeJobImages(message: string, root: string, key: string, attempt: number) {
  const refs = [...message.matchAll(/\/api\/jobs\/images\/([a-f0-9-]{36})/g)];
  if (!refs.length) return message;
  const directory = join(root, ".factory-inputs", key, String(attempt));
  await mkdir(directory, { recursive: true });
  const paths = new Map<string, string>();
  for (const match of refs) {
    const id = match[1]!;
    if (paths.has(id)) continue;
    const [image] = await db.select().from(jobImages).where(eq(jobImages.id, id));
    if (!image) throw new Error(`Job input image ${id} is missing.`);
    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[image.content_type];
    if (!extension) throw new Error(`Unsupported job input image type ${image.content_type}.`);
    const path = join(directory, `${id}.${extension}`);
    await writeFile(path, image.bytes);
    paths.set(id, path.replaceAll("\\", "/"));
  }
  return message.replace(/\/api\/jobs\/images\/([a-f0-9-]{36})/g, (_ref, id: string) => paths.get(id)!);
}
