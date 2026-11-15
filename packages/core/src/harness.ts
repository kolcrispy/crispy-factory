import { z } from "zod";

// A harness identifies an agent runtime and the models it offers, independently of its transport.

export const DEFAULT_PROVIDER = "omp";
/** Empty selects the installed runtime's native default at launch. */
export const DEFAULT_MODEL = "";

export const harnessSchema = z.object({
  /** Stable direct execution adapter identity. */
  id: z.string(),
  driver: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  models: z.array(z.object({ slug: z.string(), name: z.string() })),
  /** Runtime-selected model when no explicit repository override is configured. */
  defaultModel: z.string().optional(),
});
export type Harness = z.infer<typeof harnessSchema>;

/** Direct adapters that report lifecycle and usage through the trusted extension. */
export const TRACKED_DRIVERS: readonly string[] = ["omp"];

/** Reporting capability exposed by an execution adapter. */
export type Tracking = "full" | "none";

export const isTracked = (providerOrDriver: string) => TRACKED_DRIVERS.includes(providerOrDriver);

export const trackingOf = (providerOrDriver: string): Tracking =>
  isTracked(providerOrDriver) ? "full" : "none";

const DRIVER_LABELS: Record<string, string> = {
  omp: "OMP",
};

export const harnessLabel = (id: string, driver?: string, displayName?: string | null) =>
  displayName || DRIVER_LABELS[driver ?? id] || DRIVER_LABELS[id] || id;
