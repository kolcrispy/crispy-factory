import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./harness";
import { pricingSchema } from "./pricing";
import { inTestMode } from "./test-mode";

export const CONFIG_PATH = process.env.MARSHAL_FACTORY_CONFIG ?? join(homedir(), ".config/marshal-factory/config.json");

/** The machine a regression run's runner code acts as, so the jobs a script creates can belong to it. */
export const TEST_MACHINE_ID = "test-machine";


const home = (path: string) => path.replace(/^~(?=\/|$)/, homedir());


/** Every factory limit lives here, with defaults; the config file overrides any of them. */
export const factorySchema = z
  .object({
    maxInFlight: z.number().int().positive().default(4),
    /** A working job with no event for this long, or whose thread stopped, gets one nudge. */
    stuckAfterMinutes: z.number().positive().default(30),
    /** A stopped thread counts as stuck only after this much quiet, so a turn that just ended isn't. */
    stoppedGraceMinutes: z.number().nonnegative().default(2),
    /** After a nudge, this much more quiet marks the job failed. */
    failAfterNudgeMinutes: z.number().positive().default(30),
    /** USD per million tokens by model id, over lib/pricing.ts's defaults; null makes a model's cost unknown. The runner's spend reconcile uses it; the panel shows the defaults. */
    pricing: pricingSchema.default({}),
    /** Days a failed job keeps its worktree for a human to look at before cleanup removes it. */
    cleanupGraceDays: z.number().nonnegative().default(3),
    /** Minutes a PR head without check runs or statuses waits for CI to appear. */
    noCiGraceMinutes: z.number().nonnegative().default(5),
    /** How long the runner watches the base branch's checks after it merged a PR, reverting when they fail. */
    postMergeWatchMinutes: z.number().positive().default(60),
    /** Hours a Claude Code subagent worktree must sit untouched before cleanup considers it. */
    subagentIdleHours: z.number().nonnegative().default(6),
    /** Target repos the factory works in; the installer adds each one. */
    repos: z.array(z.string()).default([]),
    workRoot: z.string().transform(home).default(join(homedir(), ".local/share/marshal-factory/repos")),
    /** The provider and model for new factory threads when the panel's settings hold none. */
    provider: z.string().default(DEFAULT_PROVIDER),
    model: z.string().default(DEFAULT_MODEL),
    /** How often the runner's timer runs the watchdog and usage reconcile. */
    tickSeconds: z.number().positive().default(90),
    /** Stable installation runner identity; defaults to the native hostname. */
    machineId: z.string().min(1).optional(),
    /** T3's state database, read-only, for the machine inventory. */
    t3StatePath: z.string().optional(),
    /** How often the runner re-collects the slow machine inventory (T3, Connect, projects, repos). */
    inventoryMinutes: z.number().positive().default(10),
    /** How a stop is confirmed; see lib/stop.ts. The runner looks on its tick, so each wait rounds up to tickSeconds. */
    stop: z
      .object({
        /** The least time between two looks at a stopping thread. */
        checkSeconds: z.number().positive().default(15),
        /** How long the thread and its subagents must show no active run before the stop counts as confirmed. */
        settleSeconds: z.number().nonnegative().default(30),
        /** How long after the stop message the runner asks T3 to interrupt what still runs. */
        interruptAfterSeconds: z.number().nonnegative().default(60),
        /** How long after the stop message a stop that still isn't confirmed is marked unconfirmed for the owner. */
        giveUpAfterMinutes: z.number().positive().default(5),
      })
      .prefault({}),
  })
  .prefault({});
export type FactoryLimits = z.infer<typeof factorySchema>;

const configSchema = z.object({
  ingestUrl: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/ingest" && !url.username && !url.password && !url.search && !url.hash;
  }, "Agent reports require a loopback HTTP /ingest endpoint."),
  secret: z.string().min(32),
  factory: factorySchema,
});
export type FactoryConfig = z.infer<typeof configSchema>;

/** Read non-secret runner limits independently of report endpoint credentials. */
export function loadLimits(): FactoryLimits {
  const raw = existsSync(/* turbopackIgnore: true */ CONFIG_PATH) ? JSON.parse(readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf8")).factory : undefined;
  return factorySchema.parse(raw ?? {});
}

export function loadConfig(): FactoryConfig {
  if (inTestMode()) {
    return configSchema.parse({
      ingestUrl: "http://127.0.0.1:3008/ingest",
      secret: "test-only-loopback-secret-32-characters",
      factory: { machineId: TEST_MACHINE_ID },
    });
  }
  return configSchema.parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf8")));
}
