import { timingSafeEqual } from "node:crypto";
import { db } from "@factory/storage/client";
import { ingestBodySchema } from "@factory/core/events";
import { ingest } from "@factory/core/ingest";

/** Runner-owned ingress has no external-source routes and never binds a public interface. */
export function startReportServer(url: string, secret: string) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(endpoint.hostname) || endpoint.pathname !== "/ingest" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Agent reporting must use an HTTP loopback /ingest endpoint.");
  }
  if (secret.length < 32) throw new Error("Agent reporting requires a secret of at least 32 characters.");
  const expected = Buffer.from(`Bearer ${secret}`);
  return Bun.serve({
    hostname: "127.0.0.1",
    port: Number(endpoint.port || 80),
    maxRequestBodySize: 8 * 1024 * 1024,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/ingest") return Response.json({ error: "not found" }, { status: 404 });
      const supplied = Buffer.from(request.headers.get("authorization") ?? "");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
      const parsed = ingestBodySchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
      try {
        return Response.json(await ingest(db, parsed.data));
      } catch {
        console.error("Agent report persistence failed; delivery remains retryable.");
        return Response.json({ error: "report persistence failed" }, { status: 500 });
      }
    },
  });
}
