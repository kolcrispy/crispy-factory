import "./test-guard";
import assert from "node:assert/strict";
import { Client } from "pg";
import * as schema from "../packages/storage/src/schema";
import { checkSnapshot } from "./check-schema";

await checkSnapshot();
const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await client.connect();
try {
  await client.query("SET default_transaction_read_only = on");
  const { generateDrizzleJson } = await import("drizzle-kit/api");
  const expected = generateDrizzleJson(schema) as { tables: Record<string, { name: string; columns: Record<string, { name: string; type: string; notNull: boolean }>; foreignKeys: Record<string, unknown>; uniqueConstraints: Record<string, unknown>; checkConstraints: Record<string, unknown>; indexes: Record<string, unknown> }>; enums: Record<string, { name: string; values: string[] }> };
  const tables = await client.query("select tablename from pg_tables where schemaname = 'public' order by tablename");
  assert.deepEqual(tables.rows.map(row => row.tablename), Object.values(expected.tables).map(table => table.name).sort(), "Migrated table names match schema");
  for (const table of Object.values(expected.tables)) {
    const columns = await client.query("select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as required from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped order by a.attname", [table.name]);
    assert.deepEqual(columns.rows, Object.values(table.columns).map(column => ({ name: column.name, type: column.type, required: column.notNull })).sort((a, b) => a.name.localeCompare(b.name)), `Migrated columns match ${table.name}`);
    const constraints = await client.query("select conname from pg_constraint where conrelid = $1::regclass and contype in ('f', 'u', 'c') order by conname", [`public.${table.name}`]);
    assert.deepEqual(constraints.rows.map(row => row.conname), [...Object.keys(table.foreignKeys), ...Object.keys(table.uniqueConstraints), ...Object.keys(table.checkConstraints)].sort(), `Migrated constraints match ${table.name}`);
    const indexes = await client.query("select indexname from pg_indexes where schemaname = 'public' and tablename = $1 and indexname not in (select conname from pg_constraint where conrelid = $2::regclass) order by indexname", [table.name, `public.${table.name}`]);
    assert.deepEqual(indexes.rows.map(row => row.indexname), Object.keys(table.indexes).sort(), `Migrated indexes match ${table.name}`);
  }
  const enums = await client.query("select t.typname as name, json_agg(e.enumlabel order by e.enumsortorder) as values from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid where n.nspname = 'public' group by t.typname order by t.typname");
  assert.deepEqual(enums.rows, Object.values(expected.enums).map(value => ({ name: value.name, values: value.values })).sort((a, b) => a.name.localeCompare(b.name)), "Migrated enums match schema");
  console.log("Migrated tables, columns, constraints, indexes and enums match schema");
} finally {
  await client.end();
}
