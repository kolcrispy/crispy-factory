import { z } from "zod";

// A harness identifies an agent runtime and the models it offers, independently of its transport.

export const DEFAULT_PROVIDER = "claudeAgent";
export const DEFAULT_MODEL = "claude-opus-5-5";

export const harnessSchema = z.object({
  /** Stable runner harness identity; T3-backed harnesses use their provider instance id. */
  id: z.string(),
  driver: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  models: z.array(z.object({ slug: z.string(), name: z.string() })),
  /** Runtime-selected model when no explicit repository override is configured. */
  defaultModel: z.string().optional(),
});
export type Harness = z.infer<typeof harnessSchema>;

/** Drivers whose sessions run the factory's hooks and MCP reporter, so stages and cost work. */
export const TRACKED_DRIVERS: readonly string[] = ["claudeAgent", "omp"];

/** Drivers without hooks whose factory-report MCP server posts their stages, questions, PRs and assessments; the runner reads their cost from their session logs (lib/codex-usage.ts). */
export const STAGE_REPORTING_DRIVERS: readonly string[] = ["codex"];

/** `full` reports usage through hooks; `stages` reports stages and has a cost once the runner read it; `none` reports neither. */
export type Tracking = "full" | "stages" | "none";

export const isTracked = (providerOrDriver: string) => TRACKED_DRIVERS.includes(providerOrDriver);

export const trackingOf = (providerOrDriver: string): Tracking =>
  isTracked(providerOrDriver) ? "full" : STAGE_REPORTING_DRIVERS.includes(providerOrDriver) ? "stages" : "none";

const DRIVER_LABELS: Record<string, string> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  antigravity: "Antigravity",
  omp: "OMP",
};

export const harnessLabel = (id: string, driver?: string, displayName?: string | null) =>
  displayName || DRIVER_LABELS[driver ?? id] || DRIVER_LABELS[id] || id;
