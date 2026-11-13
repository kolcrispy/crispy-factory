import { loginOwner, logoutOwner } from "@factory/core/auth/accounts";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../../../../lib/auth/server";
import { dashboardOrigin, sameOrigin } from "../../../../lib/auth/request";

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const path = (await context.params).path.join("/");
  const jar = await cookies();
  if (path === "logout") {
    await logoutOwner(jar.get(SESSION_COOKIE)?.value);
    jar.delete(SESSION_COOKIE);
    return Response.json({ ok: true });
  }
  if (path !== "login") return new Response(null, { status: 404 });
  if (Number(request.headers.get("content-length")) > 8192) return new Response(null, { status: 413 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (!input || typeof input !== "object" || !("email" in input) || !("password" in input) || typeof input.email !== "string" || typeof input.password !== "string") {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  // Only trust a proxy-provided client address when explicitly configured at deployment.
  const header = process.env.FACTORY_CLIENT_IP_HEADER;
  const network = header ? request.headers.get(header)?.trim() : "shared";
  if (header && !network) return Response.json({ error: "Client address unavailable" }, { status: 503 });
  const session = await loginOwner(input.email, input.password, network!);
  if (!session) return Response.json({ error: "Invalid credentials or too many login attempts. Try again later." }, { status: 401 });
  jar.set(SESSION_COOKIE, session.token, { httpOnly: true, secure: dashboardOrigin().protocol === "https:", sameSite: "lax", path: "/", expires: session.expires });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
