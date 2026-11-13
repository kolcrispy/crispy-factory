import "@factory/platform/environment";
import { migrateRefusal } from "@factory/core/migrate-guard";

const refusal = migrateRefusal(process.env);
if (refusal) {
  console.error(`Refusing to migrate: ${refusal}.`);
  process.exit(1);
}
