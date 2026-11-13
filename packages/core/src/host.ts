import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exec, type ExecOptions } from "@factory/platform/exec";
import { forbidInTest } from "./test-mode";
import { runT3, t3Command } from "@factory/platform/t3";

/**
 * The machine a job's thread, worktree and transcripts live on. `run` settles like promisified
 * execFile: it resolves with the output of a zero exit and rejects with an ExecError.
 */
export type JobHost = {
  /** The T3 CLI on this host. */
  readonly t3: string;
  run(command: string, args: string[], options?: ExecOptions): Promise<{ stdout: string; stderr: string }>;
  /** The file's text, or null when it does not exist. */
  readFile(path: string): Promise<string | null>;
  /** Writes the file, creating its parent directories. */
  writeFile(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
  mtimeMs(path: string): Promise<number>;
  remove(path: string): Promise<void>;
};

const localT3 = t3Command;
const GUARDED_T3 = new Set(["start", "show", "send"]);

export const localHost: JobHost = {
  get t3() {
    return localT3();
  },
  async run(command, args, options) {
    if (command === localT3() && args[0] === "thread" && GUARDED_T3.has(args[1]!)) forbidInTest(`t3 thread ${args[1]}`);
    return command === localT3() ? runT3(command, args, options) : exec(command, args, options);
  },
  async readFile(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  async writeFile(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
  exists: async (path) => existsSync(path),
  list: async (dir) => readdirSync(dir),
  mtimeMs: async (path) => statSync(path).mtimeMs,
  remove: async (path) => rmSync(path, { recursive: true, force: true }),
};

/** A job's execution environment is no longer available. */
export class HostGoneError extends Error {}

export type HostedJob = { key: string };

/** Injectable job-command boundary. All attempts execute on this runner. */
export const hosts: { forJob: (job: HostedJob) => JobHost } = {
  forJob: () => localHost,
};
