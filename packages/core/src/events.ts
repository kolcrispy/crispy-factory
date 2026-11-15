import { z } from "zod";
import { assessmentInputSchema } from "./assessment";
import { evidenceShape } from "./evidence";
import { screenshotShape } from "./screenshots";

export const usageSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  model: z.string(),
});
export type Usage = z.infer<typeof usageSchema>;

export const STAGES = [
  "queued",
  "building",
  "reviewing",
  "ready",
  "done",
  "failed",
] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;

/** Internal runner phase changes are not a builder reporting tool. */
export const stageReportShape = {
  stage: stageSchema,
  summary: z.string().min(1).max(500),
  prUrl: z.url().optional(),
  question: z.string().min(1).max(2000).optional(),
  assessment: assessmentInputSchema.optional(),
};

/** Builders report facts; only the runner selects a delivery phase. */
export const builderReportShape = {
  action: z.enum(["progress", "needs_human", "handoff"]),
  summary: z.string().min(1).max(500),
  question: z.string().min(1).max(2000).optional(),
  sha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  evidenceEventId: z.string().min(1).optional(),
  assessment: assessmentInputSchema.optional(),
};
export const builderReportSchema = z.object(builderReportShape).superRefine((report, ctx) => {
  if (report.action === "needs_human" && !report.question) ctx.addIssue({ code: "custom", path: ["question"], message: "needs_human requires an actionable question." });
  if (report.action === "handoff" && (!report.sha || !report.evidenceEventId)) ctx.addIssue({ code: "custom", path: ["sha"], message: "handoff requires sha and evidenceEventId from factory-verify." });
  if (report.action !== "handoff" && (report.sha || report.evidenceEventId || report.assessment)) ctx.addIssue({ code: "custom", message: "Only handoff accepts revision, evidence and assessment." });
});
export type BuilderReport = z.infer<typeof builderReportSchema>;

const base = {
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  at: z.number().int().nonnegative(),
  /** The main session transcript; recorded so usage can be rebuilt when no Stop hook ever fires. */
  transcriptPath: z.string().optional(),
};

export const eventSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("session_start"),
    cwd: z.string(),
    branch: z.string().optional(),
    repo: z.string().optional(),
    source: z.enum(["startup", "resume", "compact"]).optional(),
    t3ThreadId: z.string().optional(),
    title: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("agent_start"),
    toolUseId: z.string().min(1),
    subagentType: z.string(),
    description: z.string(),
    model: z.string().optional(),
    parentAgentId: z.string().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("agent_launched"),
    toolUseId: z.string().min(1),
    agentId: z.string().min(1),
  }),
  z.object({
    ...base,
    kind: z.literal("agent_stop"),
    agentId: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    usage: usageSchema,
    model: z.string().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("turn_stop"),
    usage: usageSchema,
    lastMessage: z.string().max(500).optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("stage"),
    ...stageReportShape,
    jobKey: z.string().optional(),
    issueKey: z.undefined({ error: "issueKey was renamed to jobKey" }).optional(),
    /** The branch the reporting thread was on; absent on events the runner posts itself. */
    branch: z.string().optional(),
    /** Set by the runner when a human answered a waiting question and the run resumes. */
    answer: z.string().max(4000).optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("builder_report"),
    ...builderReportShape,
    jobKey: z.string().min(1),
    branch: z.string().min(1),
  }),
  z.object({
    ...base,
    // A mid-turn snapshot of the main session's usage, so spend is known before the turn ends.
    kind: z.literal("usage"),
    usage: usageSchema,
    /** Subagents of the session with their usage so far, so running ones count before SubagentStop. */
    agents: z
      .array(z.object({ agentId: z.string().min(1), toolUseId: z.string().optional(), usage: usageSchema }))
      .optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("session_end"),
    reason: z.string().optional(),
  }),
  z.object({
    ...base,
    // The checks run at one commit, by factory-verify or by the runner; see lib/evidence.ts.
    kind: z.literal("evidence"),
    ...evidenceShape,
  }),
  z.object({
    ...base,
    // One image a pr report's assessment attached; see lib/screenshots.ts.
    kind: z.literal("screenshot"),
    ...screenshotShape,
  }),
]);
export type FactoryEvent = z.infer<typeof eventSchema>;
export type EventKind = FactoryEvent["kind"];

export const MAX_BATCH = 100;

export const ingestBodySchema = z
  .union([eventSchema, z.array(eventSchema).min(1).max(MAX_BATCH)])
  .transform((body) => (Array.isArray(body) ? body : [body]));
