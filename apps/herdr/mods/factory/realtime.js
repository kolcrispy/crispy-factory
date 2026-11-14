import { connect } from "net";

/** Native fetch buffers bodies, so SSE uses the runtime's loopback TCP capability. */
export async function subscribe(config, receive) {
  const match = /^(http:\/\/)(localhost|127\.0\.0\.1):(\d+)\/?$/.exec(config.url);
  if (!match || !/^[A-Za-z0-9_-]+$/.test(config.token)) throw new Error("Invalid local realtime configuration");
  const socket = await connect(match[2], Number(match[3]));
  await socket.write(`GET /api/events HTTP/1.1\r\nHost: ${match[2]}:${match[3]}\r\nAuthorization: Bearer ${config.token}\r\nConnection: close\r\n\r\n`);
  let buffer = "";
  let headers = false;
  let chunked = false;
  let remaining = null;
  let sse = "";
  const consume = body => {
    sse += body;
    let end;
    while ((end = sse.indexOf("\n\n")) !== -1) {
      const frame = decodeURIComponent(Array.from(sse.slice(0, end), character => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
      sse = sse.slice(end + 2);
      if (frame.split("\n").some(line => line === "event: snapshot")) {
        const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        receive(JSON.parse(data));
      }
    }
  };
  try {
    for (;;) {
      const bytes = await socket.read();
      if (!bytes) throw new Error("Runner disconnected");
      // Preserve bytes until HTTP chunk framing has been removed; UTF-8 decoding is below.
      buffer += Array.from(bytes, byte => String.fromCharCode(byte)).join("");
      if (!headers) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) continue;
        const head = buffer.slice(0, end);
        if (!/^HTTP\/1\.[01] 200\b/.test(head)) throw new Error("Runner rejected connection; pair again if revoked");
        chunked = /transfer-encoding:\s*chunked/i.test(head);
        buffer = buffer.slice(end + 4);
        headers = true;
      }
      if (!chunked) { consume(buffer); buffer = ""; continue; }
      for (;;) {
        if (remaining === null) {
          const end = buffer.indexOf("\r\n");
          if (end < 0) break;
          remaining = parseInt(buffer.slice(0, end).split(";")[0], 16);
          if (!Number.isFinite(remaining) || remaining === 0) throw new Error("Runner stream ended");
          buffer = buffer.slice(end + 2);
        }
        if (buffer.length < remaining + 2) break;
        consume(buffer.slice(0, remaining));
        buffer = buffer.slice(remaining + 2);
        remaining = null;
      }
    }
  } finally { socket.close(); }
}
