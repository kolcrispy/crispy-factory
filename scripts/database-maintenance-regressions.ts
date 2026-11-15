import "./test-guard";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const admin = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await admin.connect();
const name = `maintenance_${crypto.randomUUID().replaceAll("-", "")}`;
const dir = await mkdtemp(join(tmpdir(), "factory-backup-"));
const url = new URL(process.env.DATABASE_URL_UNPOOLED!);
url.pathname = `/${name}`;
const env = { ...process.env, DATABASE_URL: url.href, DATABASE_URL_UNPOOLED: url.href };
async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "scripts/database-maintenance.ts", ...args], { env, stdout: "pipe", stderr: "pipe" });
  return { code: await child.exited, out: await new Response(child.stdout).text(), error: await new Response(child.stderr).text() };
}
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new Client({ connectionString: url.href });
  await target.connect();
  await target.query("create table retained (value text); insert into retained values ('backup sentinel')");
  await target.end();
  const backup = join(dir, "before.dump");
  let result = await run(["backup", "--backup", backup]);
  assert.equal(result.code, 0, result.error);
  const manifest = JSON.parse(await readFile(`${backup}.json`, "utf8"));
  const reset = ["reset", "--backup", backup, "--services-stopped", "--confirm", manifest.target];
  assert.notEqual((await run([...reset.slice(0, -1), "wrong-target"])).code, 0, "wrong target refuses");
  const bytes = await readFile(backup);
  await writeFile(backup, "corrupt");
  assert.notEqual((await run(reset)).code, 0, "modified backup refuses");
  await writeFile(backup, bytes);
  const owner = new Client({ connectionString: url.href });
  await owner.connect();
  await owner.query("select pg_advisory_lock(hashtextextended($1, 0))", ["crispy-factory active runner"]);
  assert.notEqual((await run(reset)).code, 0, "active runner refuses");
  await owner.end();
  result = await run(reset);
  assert.equal(result.code, 0, result.error);
  const proof = new Client({ connectionString: url.href });
  await proof.connect();
  try {
    assert.equal((await proof.query("select count(*)::int as n from jobs")).rows[0].n, 0);
    assert.equal((await proof.query("select to_regclass('public.retained') as retained")).rows[0].retained, null);
  } finally { await proof.end(); }
  const restore = Bun.spawn([process.env.FACTORY_PG_RESTORE || "pg_restore", "--exit-on-error", "--clean", "--if-exists", "--dbname", url.href, backup], { stdout: "pipe", stderr: "pipe" });
  const error = await new Response(restore.stderr).text();
  assert.equal(await restore.exited, 0, error);
  const restored = new Client({ connectionString: url.href });
  await restored.connect();
  try { assert.equal((await restored.query("select value from retained")).rows[0].value, "backup sentinel"); }
  finally { await restored.end(); }
  console.log("Verified backup, reset refusal, migration and restore regressions passed");
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  await rm(dir, { recursive: true, force: true });
}
