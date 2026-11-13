import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

export type OmpFrame = { type: string; [key: string]: unknown };
export type OmpCommand = { type: string; [key: string]: unknown };

type Pending = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** One native OMP RPC process. A command timeout never implies its action was cancelled. */
export class OmpRpc {
  readonly process: ChildProcessWithoutNullStreams;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private readonly pending = new Map<string, Pending>();
  private failure: Error | undefined;
  private stderr = "";

  constructor(options: {
    command: string;
    args?: string[];
    cwd: string;
    env?: NodeJS.ProcessEnv;
    onEvent?: (frame: OmpFrame) => void;
  }) {
    this.process = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "pipe",
      windowsHide: true,
      shell: false,
    });
    const lines = createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    lines.on("line", line => {
      let frame: OmpFrame;
      try {
        frame = JSON.parse(line) as OmpFrame;
        if (!frame || typeof frame.type !== "string") throw new Error("Missing frame type");
      } catch {
        this.fail(new Error("OMP emitted an invalid RPC frame."));
        return;
      }
      if (frame.type === "response" && typeof frame.id === "string") {
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        this.pending.delete(frame.id);
        clearTimeout(pending.timer);
        if (frame.success === true) pending.resolve(frame.data);
        else pending.reject(new Error(typeof frame.error === "string" ? frame.error : "OMP rejected the command."));
        return;
      }
      try { options.onEvent?.(frame); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    this.process.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8192);
    });
    this.process.stdin.on("error", error => this.fail(error));
    this.process.on("error", error => this.fail(error));
    const exit = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
    this.exited = exit.promise;
    this.process.once("close", (code, signal) => {
      lines.close();
      this.fail(new Error(`OMP RPC exited (${signal ?? code ?? "unknown"}).`));
      exit.resolve({ code, signal });
    });
  }

  request<T = unknown>(command: OmpCommand, timeoutMs = 15_000): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`OMP ${command.type} timed out; delivery is uncertain.`));
    }, timeoutMs);
    this.pending.set(id, { resolve: data => resolve(data as T), reject, timer });
    this.process.stdin.write(`${JSON.stringify({ ...command, id })}\n`, error => {
      if (error) this.fail(error);
    });
    return promise;
  }

  /** Replies to an RPC host request without waiting for a response. */
  reply(frame: OmpFrame) {
    if (this.failure) throw this.failure;
    this.process.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  diagnostics() {
    return this.stderr;
  }

  async close() {
    this.process.stdin.end();
    this.process.kill();
    await this.exited;
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }
}
