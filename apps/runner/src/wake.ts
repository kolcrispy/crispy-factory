import type { Pool } from "pg";

/** Coalesce bursts without losing a signal received while a pass is running. */
export function wakeScheduler(enqueue: (run: () => Promise<void>) => void, pass: () => Promise<void>) {
  let scheduled = false;
  let dirty = false;
  let stopped = false;
  const wake = () => {
    if (stopped) return;
    dirty = true;
    if (scheduled) return;
    scheduled = true;
    enqueue(async () => {
      dirty = false;
      try {
        await pass();
      } finally {
        scheduled = false;
        if (dirty) wake();
      }
    });
  };
  return { wake, stop: () => { stopped = true; } };
}

/** Notifications are hints; durable projections and periodic reconciliation remain authoritative. */
export async function listenForWork(pool: Pool, wake: () => void, lost: (error: Error) => void, channel: "factory_work" | "factory_status" = "factory_work") {
  const client = await pool.connect();
  client.on("error", lost);
  const notification = (message: { channel: string }) => {
    if (message.channel === channel) wake();
  };
  client.on("notification", notification);
  try {
    await client.query(`LISTEN ${channel}`);
  } catch (error) {
    client.off("notification", notification);
    client.off("error", lost);
    client.release(true);
    throw error;
  }
  return async () => {
    client.off("notification", notification);
    try {
      await client.query(`UNLISTEN ${channel}`);
    } finally {
      client.off("error", lost);
      client.release(true);
    }
  };
}
