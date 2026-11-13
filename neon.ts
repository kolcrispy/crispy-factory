import { defineConfig } from "@neon/config/v1";
import { readAppFile } from "@factory/integrations/github/app";

export default defineConfig({
  auth: true,
  // Browsers may only open live feeds from the panel itself; sealed queries are still owner-only.
  preview: { realtime: { allowedOrigins: ["https://marshal-factory.vercel.app", "http://localhost:3007"] } },
  functions: {
    ingest: {
      name: "factory ingest",
      source: "apps/gateway/src/index.ts",
      env: {
        FACTORY_INGEST_SECRET: process.env.FACTORY_INGEST_SECRET!,
        LINEAR_WEBHOOK_SECRET: process.env.LINEAR_WEBHOOK_SECRET!,
        GITHUB_APP_WEBHOOK_SECRET: process.env.GITHUB_APP_WEBHOOK_SECRET || readAppFile().webhook_secret,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
        SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
        SLACK_OWNER_USER_ID: process.env.SLACK_OWNER_USER_ID!,
        FACTORY_OWNER_EMAILS: process.env.FACTORY_OWNER_EMAILS!,
        LINEAR_API_KEY: process.env.LINEAR_API_KEY!,
        FACTORY_PANEL_URL: process.env.FACTORY_PANEL_URL ?? "",
        // Match factory.teamKey and factory.label in the config when they differ from these.
        FACTORY_TEAM_KEY: process.env.FACTORY_TEAM_KEY ?? "FAC",
        FACTORY_LABEL: process.env.FACTORY_LABEL ?? "factory",
      },
    },
  },
});
