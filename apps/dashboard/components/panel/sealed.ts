import { useEffect, useState } from "react";

export type Feed<Row> = { initialData: Row[] };
export type FeedStatus = "live" | "connecting" | "off";

export function useFeed<Row>(feed: Feed<Row>, path: string) {
  const [rows, setRows] = useState(feed.initialData);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  useEffect(() => {
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
        if (!disposed) { setRows(result.rows as Row[]); setStatus("live"); }
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
  }, [path]);
  return { rows, status };
}
