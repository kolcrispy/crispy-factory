import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const database = `factory_test_${randomUUID().replaceAll("-", "")}`;
const port = Number(process.env.FACTORY_TEST_POSTGRES_PORT ?? 55439);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid FACTORY_TEST_POSTGRES_PORT");
const url = `postgresql://factory_test@127.0.0.1:${port}/${database}`;
const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url, FACTORY_TEST_BRANCH_ID: database, FACTORY_TEST_ENDPOINT_ID: "127", FACTORY_TEST_POSTGRES_URL: url };
const prefixes = process.argv.slice(2);
const scripts = readdirSync(import.meta.dirname).filter(file => file.endsWith("-regressions.ts") && (!prefixes.length || prefixes.some(prefix => file.startsWith(prefix)))).sort();
if (!scripts.length) throw new Error("No matching regression scripts");
const directory = mkdtempSync(join(tmpdir(), "factory-postgres-"));
const data = join(directory, "data");
const SKIP = 77;
const skipped: string[] = [];
async function run(command: string[]) {
  const child = Bun.spawn(command, { env, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code === SKIP) return code;
  if (code) throw new Error(`${command[0]} failed`);
  return code;
}
let started = false;
try {
  await run(["initdb", "-D", data, "-U", "factory_test", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  await run(["pg_ctl", "-D", data, "-l", join(directory, "server.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  started = true;
  const admin = new Client({ connectionString: `postgresql://factory_test@127.0.0.1:${port}/postgres` });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  await run([process.execPath, "node_modules/drizzle-kit/bin.cjs", "migrate"]);
  for (const script of scripts) {
    console.log(`\n== ${script}`);
    if ((await run([process.execPath, join(import.meta.dirname, script)])) === SKIP) skipped.push(script);
  }
  console.log(`All ${scripts.length - skipped.length} PostgreSQL regression scripts passed${skipped.length ? `; skipped ${skipped.join(", ")}` : ""}`);
} finally {
  if (started) await run(["pg_ctl", "-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(directory, { recursive: true, force: true });
}
