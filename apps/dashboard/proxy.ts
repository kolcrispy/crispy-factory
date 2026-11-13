import { NextResponse, type NextRequest } from "next/server";
import { sessionOwner } from "@factory/core/auth/accounts";
import { dashboardOrigin } from "./lib/auth/request";

export async function proxy(request: NextRequest) {
  const origin = dashboardOrigin();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") !== origin.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await sessionOwner(request.cookies.get("factory_owner_session")?.value, request.headers.get("x-factory-poll") !== "1");
  if (user) return NextResponse.next();
  return request.nextUrl.pathname.startsWith("/api/")
    ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    : NextResponse.redirect(new URL("/auth/sign-in", origin));
}

export const config = {
  matcher: ["/((?!(?:auth/sign-in|api/auth|_next/static|_next/image|favicon\\.ico)(?:/|$|\\.rsc$|\\.segments/)).*)"],
};
