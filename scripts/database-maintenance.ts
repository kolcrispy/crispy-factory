import "@factory/platform/environment";
import { createHash } from "node:crypto";
import { open, chmod, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { migrateRefusal } from "@factory/core/migrate-guard";

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const connection = process.env.DATABASE_URL_UNPOOLED;
if (!connection) throw new Error("DATABASE_URL_UNPOOLED is required");
const url = new URL(connection);
const target = `${url.hostname}:${url.port || "5432"}${url.pathname}`;
if ([url.hostname, url.username, url.password, url.pathname].some(value => /[\r\n]/.test(decodeURIComponent(value)))) throw new Error("Connection fields cannot contain newlines");
if ([...url.searchParams.keys()].some(key => key !== "sslmode")) throw new Error("Maintenance requires a direct URL; only sslmode query configuration is supported");
const client = new Client({ connectionString: connection, application_name: "factory-maintenance" });
const backup = args.includes("--backup") ? resolve(option("--backup")!) : undefined;
const ssh = args.includes("--ssh") ? option("--ssh") : undefined;
if (ssh && !/^[\w.@-]+$/.test(ssh)) throw new Error("Invalid SSH host alias");
const tool = (name: "pg_dump" | "pg_restore") => process.env[name === "pg_dump" ? "FACTORY_PG_DUMP" : "FACTORY_PG_RESTORE"] || name;
async function run(command: string[], input?: Uint8Array | string) {
  const child = Bun.spawn(command, { env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), ...(url.searchParams.has("sslmode") ? { PGSSLMODE: url.searchParams.get("sslmode")! } : {}) }, stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (input !== undefined) {
    await child.stdin!.write(input);
    await child.stdin!.flush();
    child.stdin!.end();
  }
  const [out, error, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(`Database tool failed (${code}): ${error.replaceAll(connection!, "[redacted]")}`);
  return new Uint8Array(out);
}
const command = (name: "pg_dump" | "pg_restore", parameters: string[]) => ssh
  ? ["ssh", "-o", "BatchMode=yes", ssh, name === "pg_dump" ? "IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; IFS= read -r PGDATABASE; IFS= read -r PGSSLMODE; export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE; exec pg_dump -w -Fc" : `exec pg_restore ${parameters.join(" ")}`]
  : [tool(name), ...parameters];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
await client.connect();
try {
  const { rows: [identity] } = await client.query("select current_database() as database, inet_server_addr()::text as address, inet_server_port() as port, current_setting('server_version_num')::int as version");
  if (args[0] === "identify") {
    console.log(JSON.stringify({ target, ...identity, auth: { urlPassword: Boolean(url.password), queryKeys: [...url.searchParams.keys()] } }));
  } else if (args[0] === "backup") {
    if (!backup) throw new Error("Supply --backup <new-file.dump>; optionally --ssh <host> for compatible remote tools");
    const version = new TextDecoder().decode(await run(ssh ? ["ssh", "-o", "BatchMode=yes", ssh, "pg_dump --version"] : [tool("pg_dump"), "--version"]));
    const major = Number(version.match(/\b(\d+)\./)?.[1]);
    if (!major || major < Math.floor(identity.version / 10000)) throw new Error("pg_dump is older than the server; select FACTORY_PG_DUMP/FACTORY_PG_RESTORE or --ssh");
    const file = await open(backup, "wx", 0o600);
    try {
      const remoteConnection = [url.hostname, url.port || "5432", decodeURIComponent(url.username), decodeURIComponent(url.password), decodeURIComponent(url.pathname.slice(1)), url.searchParams.get("sslmode") || "prefer"].join("\n") + "\n";
      const bytes = await run(command("pg_dump", ["-w", "-Fc"]), ssh ? remoteConnection : undefined);
      await run(command("pg_restore", ["--list"]), bytes);
      await file.writeFile(bytes);
      await file.sync();
      const manifest = await open(`${backup}.json`, "wx", 0o600);
      try { await manifest.writeFile(JSON.stringify({ target, identity, sha256: hash(bytes), bytes: bytes.length, verifiedAt: new Date().toISOString() }, null, 2)); }
      finally { await manifest.close(); }
    } finally { await file.close(); }
    if (process.platform !== "win32") await chmod(backup, 0o600);
    console.log(JSON.stringify({ backup, target, verified: true }));
  } else if (args[0] === "reset") {
    const refusal = migrateRefusal(process.env);
    if (refusal) throw new Error(refusal);
    if (!backup || !args.includes("--services-stopped") || !args.includes("--confirm") || option("--confirm") !== target) throw new Error(`Reset requires --backup <verified.dump> --services-stopped --confirm ${target}`);
    const manifest = JSON.parse(await readFile(`${backup}.json`, "utf8"));
    const bytes = await readFile(backup);
    if (manifest.target !== target || manifest.identity.database !== identity.database || manifest.identity.address !== identity.address || manifest.identity.port !== identity.port || manifest.sha256 !== hash(bytes) || manifest.bytes !== bytes.length) throw new Error("Backup is corrupt or belongs to another database");
    const lock = await client.query("select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired", ["crispy-factory active runner"]);
    if (!lock.rows[0].acquired) throw new Error("Stop the runner before reset");
    const sessions = await client.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'");
    if (sessions.rows[0].n) throw new Error("Other database clients remain; stop dashboard and clients before reset");
    const schemas = await client.query("select nspname from pg_namespace where nspname not like 'pg_%' and nspname not in ('information_schema', 'public', 'drizzle')");
    if (schemas.rowCount) throw new Error("Unexpected schemas; refusing reset");
    await client.query("BEGIN; DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public; COMMIT;");
    await run([process.execPath, "node_modules/drizzle-kit/bin.cjs", "migrate"]);
    console.log(JSON.stringify({ target, reset: true, migrated: true, servicesRestarted: false }));
  } else throw new Error("Usage: database-maintenance.ts identify | backup --backup <file> [--ssh host] | reset --backup <file> --services-stopped --confirm <host:port/database>");
} finally { await client.end(); }
