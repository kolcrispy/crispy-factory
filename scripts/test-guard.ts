import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { endpointOf, TEST_BRANCH_ENV, TEST_ENDPOINT_ENV } from "@factory/core/test-mode";

const ENV_FILE = ".env.local";
const DB_VARS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED"];

function refuse(reason: string): never {
  console.error(`Refusing to run: ${reason}.\nRegressions write to the database. Run them with: bun run test:regressions`);
  process.exit(1);
}

const fileEnv = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
// loadEnvFile never overrides what the harness set, so a branch URL beats the file's production URL.
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const branch = process.env[TEST_BRANCH_ENV];
const endpoint = process.env[TEST_ENDPOINT_ENV];
if (!branch || !endpoint) refuse("it was not started by the regression harness");

const postgresUrl = process.env.FACTORY_TEST_POSTGRES_URL;
if (postgresUrl) {
  const target = new URL(postgresUrl);
  if (target.hostname !== "127.0.0.1" || !/^\/factory_test_[a-f0-9]{32}$/.test(target.pathname) || target.pathname.slice(1) !== branch) refuse("invalid isolated PostgreSQL target");
  for (const name of DB_VARS) {
    if (process.env[name] !== postgresUrl) refuse(`${name} is not the isolated PostgreSQL database`);
    if (fileEnv[name] === postgresUrl) refuse("test database matches the application database");
  }
} else {
  const production = new Set(DB_VARS.flatMap((name) => (fileEnv[name] ? [endpointOf(fileEnv[name])] : [])));
  if (production.has(endpoint)) refuse(`endpoint ${endpoint} is the one ${ENV_FILE} points at`);

  for (const name of DB_VARS) {
    const url = process.env[name];
    if (!url) refuse(`${name} is not set`);
    if (endpointOf(url) !== endpoint) refuse(`${name} targets ${endpointOf(url)}, not test branch ${branch} (${endpoint})`);
  }
}
