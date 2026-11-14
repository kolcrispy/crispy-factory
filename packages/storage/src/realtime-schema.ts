import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const realtimePairings = pgTable("realtime_pairings", {
  digest: text("digest").primaryKey(),
  label: text("label").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const realtimeClients = pgTable("realtime_clients", {
  id: text("id").primaryKey(),
  digest: text("digest").notNull().unique(),
  label: text("label").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
});
