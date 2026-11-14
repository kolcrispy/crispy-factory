import "@factory/platform/environment";
import { createHash } from "node:crypto";
import { redeemRealtimePairing, realtimeClient } from "@factory/core/realtime-auth";
import { realtimeSnapshot } from "@factory/core/realtime";

export interface RealtimeServerOptions {
  port: number;
  origins: string[];
  snapshot?: () => Promise<unknown>;
  authorize?: (token: string) => Promise<string | null>;
  redeem?: (code: string) => Promise<{ id: string; token: string } | null>;
}

/** Loopback client interface, deliberately separate from trusted agent reporting. */
export function startRealtimeServer(options: RealtimeServerOptions) {
  const snapshot = options.snapshot ?? realtimeSnapshot;
  const authorize = options.authorize ?? realtimeClient;
  const redeem = options.redeem ?? redeemRealtimePairing;
  const clients = new Set<{ token: string; revision: string; send: (frame: string) => void; close: () => void }>();
  let stopped = false;
  let dirty = false;
  let pending: Promise<void> | undefined;
  const refresh = () => {
    dirty = true;
    if (pending || stopped || !clients.size) return;
    pending = (async () => {
      do {
        dirty = false;
        const data = JSON.stringify(await snapshot());
        const revision = createHash("sha256").update(data).digest("hex");
        for (const client of clients) {
          if (!(await authorize(client.token))) { client.close(); continue; }
          if (revision !== client.revision) {
            client.send(`id: ${revision}\nevent: snapshot\ndata: ${data}\n\n`);
            client.revision = revision;
          }
        }
      } while (dirty && !stopped);
    })().catch(error => {
      console.error(JSON.stringify({ event: "realtime:snapshot-error", error: String(error) }));
      for (const client of clients) client.close();
    }).finally(() => { pending = undefined; });
  };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: options.port, maxRequestBodySize: 4096,
    async fetch(request, server) {
      const url = new URL(request.url);
      const origin = request.headers.get("origin");
      const allowed = !origin || options.origins.includes(origin);
      const headers = new Headers({ "Cache-Control": "no-store", "Vary": "Origin" });
      if (origin && allowed) headers.set("Access-Control-Allow-Origin", origin);
      if (!allowed || !["127.0.0.1", "localhost"].includes(url.hostname)) return new Response("Forbidden", { status: 403 });
      if (request.method === "OPTIONS") {
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        return new Response(null, { status: 204, headers });
      }
      if (request.method === "POST" && url.pathname === "/api/pair") {
        const body = await request.json().catch(() => null) as { code?: unknown } | null;
        if (typeof body?.code !== "string" || body.code.length > 128) return Response.json({ error: "Invalid pairing code" }, { status: 400, headers });
        const paired = await redeem(body.code);
        return Response.json(paired ?? { error: "Pairing code expired or already used" }, { status: paired ? 200 : 401, headers });
      }
      const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
      if (!(await authorize(token))) return new Response("Unauthorized", { status: 401, headers });
      if (request.method === "GET" && url.pathname === "/api/jobs") return Response.json(await snapshot(), { headers });
      if (request.method !== "GET" || url.pathname !== "/api/events") return new Response("Not found", { status: 404, headers });
      server.timeout(request, 0);
      let close = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          let closed = false;
          const client = {
            revision: "",
            token,
            send(frame: string) {
              if (closed) return;
              if ((controller.desiredSize ?? 0) < 0) { close(); return; }
              controller.enqueue(encoder.encode(frame));
            },
            close: () => close(),
          };
          close = () => {
            if (closed) return;
            closed = true;
            clients.delete(client);
            clearInterval(heartbeat);
            request.signal.removeEventListener("abort", close);
            controller.close();
          };
          const heartbeat = setInterval(() => { client.send(": heartbeat\n\n"); refresh(); }, 15_000);
          clients.add(client);
          request.signal.addEventListener("abort", close, { once: true });
          refresh();
        },
        cancel() { close(); },
      });
      headers.set("Content-Type", "text/event-stream");
      headers.set("X-Accel-Buffering", "no");
      return new Response(stream, { headers });
    },
  });
  return {
    server, refresh,
    async stop() {
      stopped = true;
      for (const client of clients) client.close();
      await pending;
      await server.stop(true);
    },
  };
}
