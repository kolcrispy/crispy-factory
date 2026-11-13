import { cookies, headers } from "next/headers";
import { cache } from "react";
import { sessionOwner } from "@factory/core/auth/accounts";

export const SESSION_COOKIE = "factory_owner_session";
export const getOwner = cache(async () => sessionOwner((await cookies()).get(SESSION_COOKIE)?.value, (await headers()).get("x-factory-poll") !== "1"));

export const assertOwner = cache(async () => {
  if (!await getOwner()) throw new Error("an owner session is required");
});
