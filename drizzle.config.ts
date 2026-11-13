import { defineConfig } from "drizzle-kit";

import "@factory/platform/environment";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/storage/src/schema.ts",
  out: "./drizzle",
  // Migrations use the direct connection; the pooler can't hold session state.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
});
