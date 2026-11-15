import { z } from "zod";
import { harnessSchema, type Harness } from "./harness";

export const UNKNOWN = "unknown";
const known = <T extends z.ZodType>(shape: T) => z.union([shape, z.literal(UNKNOWN)]);
export type Known<T> = T | typeof UNKNOWN;

export const heartbeatSchema = z.object({
  cpu: known(z.object({ load1: z.number().nonnegative(), cores: z.number().int().positive() })),
  memory: known(z.object({ usedBytes: z.number().nonnegative(), totalBytes: z.number().positive() })),
  disk: known(z.object({ freeBytes: z.number().nonnegative(), totalBytes: z.number().positive() })),
  capacity: known(z.object({ max: z.number().int().positive(), inFlight: z.number().int().nonnegative() })),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;


export const inventorySchema = z.object({
  runnerSha: known(z.string()),
  repos: z.array(z.object({ path: z.string(), origin: known(z.string()) })),
  /** Optional so an inventory stored before harnesses were reported still parses. */
  harnesses: known(z.array(harnessSchema)).optional(),
});
export type Inventory = z.infer<typeof inventorySchema>;

/** Each field on its own, so one bad stat shows as unknown without hiding the others. */
export const parseHeartbeat = (value: unknown): Heartbeat | null => {
  if (typeof value !== "object" || value === null) return null;
  const fields = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(heartbeatSchema.shape).map(([key, schema]) => {
      const parsed = schema.safeParse(fields[key]);
      return [key, parsed.success ? parsed.data : UNKNOWN];
    }),
  ) as Heartbeat;
};

export const parseInventory = (value: unknown): Inventory | null => {
  const parsed = inventorySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const ONLINE_WINDOW_MS = 270_000;

export const isOnline = (lastSeenAt: Date, now: number) => now - lastSeenAt.getTime() <= ONLINE_WINDOW_MS;

/**
 * Every harness the machines report, one per provider id. Each id takes its entry from an online
 * machine over an offline one, and an enabled entry over a disabled one. Null when no machine has
 * reported its harnesses yet.
 */
export function reportedHarnesses(machines: readonly { last_seen_at: Date; inventory: unknown }[], now: number): Harness[] | null {
  const lists = machines.flatMap((m) => {
    const harnesses = parseInventory(m.inventory)?.harnesses;
    return Array.isArray(harnesses) ? [{ online: isOnline(m.last_seen_at, now), harnesses }] : [];
  });
  if (lists.length === 0) return null;
  const best = new Map<string, { harness: Harness; rank: number }>();
  for (const { online, harnesses } of lists) {
    for (const harness of harnesses) {
      const rank = (online ? 2 : 0) + (harness.enabled ? 1 : 0);
      if ((best.get(harness.id)?.rank ?? -1) < rank) best.set(harness.id, { harness, rank });
    }
  }
  return [...best.values()].map((b) => b.harness).sort((a, b) => a.name.localeCompare(b.name));
}


