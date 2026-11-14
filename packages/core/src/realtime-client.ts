export interface RealtimeConnection { url: string; token: string; }

/** Reads SSE framing across arbitrary network chunks. EOF requires a fresh snapshot on reconnect. */
export async function readRealtime(connection: RealtimeConnection, signal: AbortSignal, receive: (snapshot: unknown) => void) {
  const url = new URL(connection.url);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password) throw new Error("Realtime requires a loopback HTTP URL");
  const response = await fetch(new URL("/api/events", url), { headers: { Authorization: `Bearer ${connection.token}` }, signal, cache: "no-store" });
  if (!response.ok || !response.body) throw new Error(response.status === 401 ? "Pairing required" : "Runner unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let event = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("Runner disconnected");
      buffer += decoder.decode(chunk.value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (!line) {
          if (event === "snapshot" && data.length) receive(JSON.parse(data.join("\n")));
          event = ""; data = [];
        } else if (line.startsWith("event:")) event = line.slice(6).trimStart();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
