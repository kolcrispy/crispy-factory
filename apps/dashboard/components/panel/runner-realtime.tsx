"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readRealtime, type RealtimeConnection } from "@factory/core/realtime-client";

interface LiveState { snapshot: Record<string, unknown[]> | null; live: boolean; receivedAt: number; }
const Context = createContext<LiveState>({ snapshot: null, live: false, receivedAt: 0 });
export function useRunnerRealtime() { return useContext(Context); }

export function RunnerRealtime({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<RealtimeConnection | null>(() => {
    try { const saved = typeof window === "undefined" ? null : sessionStorage.getItem("factory-realtime"); return saved ? JSON.parse(saved) : null; }
    catch { return null; }
  });
  const [state, setState] = useState<LiveState>({ snapshot: null, live: false, receivedAt: 0 });
  const [url, setUrl] = useState("http://127.0.0.1:3009");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      void readRealtime(connection, controller.signal, value => {
        const snapshot = value as Record<string, unknown[]> & { version?: number };
        if (snapshot.version !== 1 || !Array.isArray(snapshot.jobs)) throw new Error("Unsupported runner snapshot");
        setState({ snapshot, live: true, receivedAt: Date.now() }); setError("");
      }).catch(error => {
        if (controller.signal.aborted) return;
        setState(previous => ({ ...previous, live: false }));
        setError(error instanceof Error ? error.message : "Runner disconnected");
        timer = setTimeout(connect, 5000);
      });
    };
    connect();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [connection]);
  async function pair() {
    setBusy(true);
    try {
      const endpoint = new URL(url);
      if (endpoint.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error("Use a loopback HTTP runner URL");
      const response = await fetch(new URL("/api/pair", endpoint), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (!response.ok) throw new Error("Pairing failed. Generate a fresh code with cli realtime pair.");
      const result = await response.json() as { token: string };
      const next = { url: endpoint.origin, token: result.token };
      sessionStorage.setItem("factory-realtime", JSON.stringify(next));
      setConnection(next); setCode(""); setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "Pairing failed"); }
    finally { setBusy(false); }
  }
  return <Context value={state}>
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs" role="status">
      <span>{state.live ? "Runner live" : "Runner offline / unpaired - fallback data"}</span>
      {!state.live && <details><summary className="cursor-pointer">Connect runner</summary><div className="flex flex-wrap items-center gap-2 py-2">
        <label>Runner URL <input className="rounded border px-2 py-1" value={url} onChange={event => setUrl(event.target.value)} /></label>
        <label>Pairing code <input type="password" className="rounded border px-2 py-1" value={code} onChange={event => setCode(event.target.value)} /></label>
        <button className="rounded border px-2 py-1" disabled={busy || !code} onClick={() => void pair()}>Pair</button>
        <span>Run: bun run cli realtime pair</span>
      </div></details>}
      {error && <span>{error}</span>}
    </div>
    {children}
  </Context>;
}
