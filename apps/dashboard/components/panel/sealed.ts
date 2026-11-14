import { useEffect, useState } from "react";
import { useRunnerRealtime } from "./runner-realtime";

export type Feed<Row> = { initialData: Row[] };
export type FeedStatus = "live" | "connecting" | "off";

export function useFeed<Row>(feed: Feed<Row>, path: string) {
  const [rows, setRows] = useState(feed.initialData);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [polledAt, setPolledAt] = useState(0);
  const realtime = useRunnerRealtime();
  const key = path.match(/^\/api\/live\/(jobs|runs|agents|machines)$/)?.[1];
  const liveRows = key ? realtime.snapshot?.[key] : undefined;
  useEffect(() => {
    if (key && realtime.live) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    async function refresh() {
      if (document.hidden || disposed || controller) return;
      controller = new AbortController();
      try {
        const response = await fetch(path, { cache: "no-store", headers: { "x-factory-poll": "1" }, signal: controller.signal });
        if (!response.ok) throw new Error("Polling failed");
        const result = await response.json() as { rows: Record<string, unknown>[]; dateFields: string[] };
        for (const row of result.rows) for (const key of result.dateFields) if (typeof row[key] === "string") row[key] = new Date(row[key]);
        if (!disposed) { setRows(result.rows as Row[]); setPolledAt(Date.now()); setStatus("live"); }
      } catch { if (!disposed) setStatus("connecting"); }
      finally {
        controller = undefined;
        if (!disposed && !document.hidden) timer = setTimeout(refresh, 5000);
      }
    }
    function resume() {
      clearTimeout(timer);
      if (document.hidden) { controller?.abort(); setStatus("off"); }
      else void refresh();
    }
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("factory:refresh", resume);
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("factory:refresh", resume);
    };
  }, [path, key, realtime.live]);
  if (liveRows && (realtime.live || realtime.receivedAt > polledAt)) {
    const decoded = liveRows.map(value => Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, typeof item === "string" && /_at$/.test(key) ? new Date(item) : item])));
    return { rows: decoded as Row[], status: realtime.live ? "live" as const : "connecting" as const };
  }
  return { rows, status };
}
