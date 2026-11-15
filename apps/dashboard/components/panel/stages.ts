import type { Stage } from "@factory/core/events";

export const STAGE_META: Record<Stage, { label: string; dot: string }> = {
  queued: { label: "Queued", dot: "bg-faint" },
  building: { label: "Building", dot: "bg-primary" },
  reviewing: { label: "Reviewing", dot: "bg-warning" },
  ready: { label: "Ready", dot: "bg-primary" },
  done: { label: "Done", dot: "bg-success" },
  failed: { label: "Failed", dot: "bg-destructive" },
};

export const MAIN_PATH: readonly Stage[] = [
  "queued",
  "building",
  "reviewing",
  "ready",
  "done",
];
