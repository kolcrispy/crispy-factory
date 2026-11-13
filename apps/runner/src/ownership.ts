import type { Pool } from "pg";

/** A dedicated PostgreSQL session owns the installation until shutdown or connection loss. */
export async function acquireRunnerOwnership(pool: Pool, lost: (error: Error) => void) {
  const client = await pool.connect();
  const key = "marshal-factory active runner";
  try {
    const { rows } = await client.query<{ acquired: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired", [key]);
    if (!rows[0]?.acquired) throw new Error("Another runner already owns this factory database.");
  } catch (error) {
    client.release();
    throw error;
  }
  client.on("error", lost);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    client.off("error", lost);
    try {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
    } finally {
      client.release(true);
    }
  };
}
