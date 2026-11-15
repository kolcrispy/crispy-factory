import "@factory/platform/environment";
import { operator } from "./operator";
import { parseArgs } from "node:util";
import { hostname, userInfo } from "node:os";
import { randomUUID } from "node:crypto";
import { db } from "@factory/storage/client";
import { redact, secretValues } from "@factory/core/secrets";
import { redact as redactDiagnostic } from "@factory/core/recipe";
import { ownerCommand } from "./owners";
import { createRealtimePairing, listRealtimeClients, revokeRealtimeClient } from "@factory/core/realtime-auth";
import { loadLimits } from "@factory/core/config";

class InputError extends Error {}

const HELP = `Factory operator CLI (trusted local database access, no dashboard account)

Usage: factory <resource> <action> [--input JSON | --stdin] [--actor NAME]

Resources:
  jobs list|show|controls|defaults|create|from-issue|answer|changes|review|review-changes|review-settings|stop|approve|close|dismiss|retry|retry-stop|archive|unarchive|follow-up
  machines list
  evidence list
  inbox list
  settings show|save
  repositories list|add|save|default|remove|retry
  requests show
  owners create|reset|disable (email input; passwords prompted in terminal)
  realtime pair|clients|revoke (read-only local client credentials)

Input is a JSON object. Use --stdin for secrets; secret values in argv are forbidden.
Job actions require jobId. Durable actions accept requestId (UUID); retain it for replay.
Use --wait SECONDS for an accepted intent; timeout leaves accepted work queued.
Configuration: .env.local or exported environment, DATABASE_URL. Runner uses its own gh login.
`;

const COMMANDS = new Set([
  ..."list show controls defaults create from-issue answer changes review review-changes review-settings stop approve close dismiss retry retry-stop archive unarchive follow-up".split(" ").map(action => `jobs ${action}`),
  "machines list", "evidence list", "inbox list", "requests show",
  ..."show save".split(" ").map(action => `settings ${action}`),
  ..."list add save default remove retry".split(" ").map(action => `repositories ${action}`),
  "owners create", "owners reset", "owners disable",
  "realtime pair", "realtime clients", "realtime revoke",
]);

export async function main(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: "boolean", short: "h" }, input: { type: "string" }, stdin: { type: "boolean" }, actor: { type: "string" }, wait: { type: "string" },
  } });
  if (values.help || positionals.length === 0) { console.log(HELP); return 0; }
  const [resource, action] = positionals;
  if (!action || positionals.length !== 2) throw new InputError("Provide a resource and action. Use --help.");
  if (!COMMANDS.has(`${resource} ${action}`)) throw new InputError("Unknown command. Use --help.");
  if (values.input && values.stdin) throw new InputError("Choose --input or --stdin.");
  const wait = values.wait === undefined ? undefined : Number(values.wait);
  if (wait !== undefined && (!Number.isFinite(wait) || wait < 0)) throw new InputError("--wait must be a nonnegative number of seconds.");
  let input: Record<string, unknown>;
  try { input = JSON.parse(values.stdin ? await Bun.stdin.text() : values.input ?? "{}"); }
  catch { throw new InputError("Input must be valid JSON."); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InputError("Input must be a JSON object.");
  if (resource === "owners") {
    if (Object.keys(input).some(key => key !== "email")) throw new InputError("Owner commands accept only email; passwords are prompted securely.");
    console.log(JSON.stringify(await ownerCommand(action, input.email)));
    return 0;
  }
  if (resource === "realtime") {
    if (action === "pair") {
      const label = typeof input.label === "string" ? input.label.trim() : "Local client";
      if (!label || label.length > 100) throw new InputError("Client label must contain 1-100 characters.");
      console.log(JSON.stringify({ ...(await createRealtimePairing(label)), url: `http://127.0.0.1:${loadLimits().realtime.port}` }));
    } else if (action === "clients") console.log(JSON.stringify({ clients: await listRealtimeClients() }));
    else {
      if (typeof input.id !== "string") throw new InputError("Client id is required.");
      await revokeRealtimeClient(input.id);
      console.log(JSON.stringify({ ok: true }));
    }
    return 0;
  }
  const requestId = input.requestId ?? randomUUID();
  if (!process.env.DATABASE_URL) throw new InputError("DATABASE_URL is required for trusted operator access.");
  const result = await operator(resource, action, { ...input, requestId }, values.actor ?? `local:${userInfo().username}@${hostname()}`, wait);
  const secrets = secretValues(process.env);
  console.log(JSON.stringify(result, (_key, value) => typeof value === "string" ? redact(value, secrets) : value, 2));
  return result.ok === false || result.status === "failed" || result.status === "refused" ? 1 : result.status === "timeout" ? 2 : 0;
}

if (import.meta.main) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) {
    let cause = error;
    const seen = new Set<unknown>();
    while (cause instanceof Error && cause.cause && !seen.has(cause)) {
      seen.add(cause);
      cause = cause.cause;
    }
    const detail = cause instanceof Error ? cause.message || ("code" in cause ? String(cause.code) : "Service connection failed.") : "Command failed.";
    const message = error instanceof InputError ? error.message : redactDiagnostic(redact(detail, secretValues(process.env)));
    console.error(JSON.stringify({ ok: false, message }));
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}
