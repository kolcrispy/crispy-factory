import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const ownerAccounts = pgTable("owner_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ownerSessions = pgTable("owner_sessions", {
  token_hash: text("token_hash").primaryKey(),
  owner_id: text("owner_id").notNull().references(() => ownerAccounts.id, { onDelete: "cascade" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  last_active_at: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const loginAttempts = pgTable("owner_login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  window_start: timestamp("window_start", { withTimezone: true }).notNull(),
});
