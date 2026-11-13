import { endpointOf } from "./test-mode";

/** Compute endpoints of the production branch, br-nameless-dawn-b9ku4ts5. Add any new one here. */
export const PRODUCTION_ENDPOINTS = new Set(["ep-odd-field-b95xpf9v"]);

const DB_VARS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const;

/** Explicit production migrations require operator acknowledgment; previews never gain that grant. */
export function migrateRefusal(env: Record<string, string | undefined>): string | null {
  const production = env.FACTORY_MIGRATION_TARGET === "production" && (!env.VERCEL_ENV || env.VERCEL_ENV === "production");
  const target = env.VERCEL_ENV ?? "non-production";
  for (const name of DB_VARS) {
    const url = env[name];
    if (!url) return `${name} is not set`;
    let endpoint: string;
    try {
      endpoint = endpointOf(url);
    } catch (error) {
      return `${name} ${(error as Error).message}`;
    }
    if (PRODUCTION_ENDPOINTS.has(endpoint) && !production) return `${name} points at the production branch (${endpoint}) in a ${target} build; explicit production migrations require FACTORY_MIGRATION_TARGET=production`;
  }
  return null;
}
