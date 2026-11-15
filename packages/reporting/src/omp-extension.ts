import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { builderReportSchema, type BuilderReport, type FactoryEvent } from "@factory/core/events";
import { reportEvents } from "@factory/core/outbox";
import { mcpIdentity } from "@factory/core/report-identity";
import { screenshotEvents, unreadable } from "@factory/core/screenshot-files";

// Structural contract: the extension runs inside the installed OMP, not a second bundled OMP.
type ReportingExtension = {
  registerTool: (tool: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, input: BuilderReport) => Promise<{
      content: { type: "text"; text: string }[];
      details: { action: string };
      isError?: boolean;
    }>;
  }) => void;
};

export default function factoryReporting(omp: ReportingExtension) {
  omp.registerTool({
    name: "report_work",
    label: "Report factory work",
    description: "Report progress, needs_human with an actionable question, or handoff with exact sha and evidenceEventId returned by factory-verify. The runner owns phases and PR publication. Never merge yourself.",
    parameters: z.toJSONSchema(builderReportSchema),
    async execute(toolCallId, input) {
      const report = builderReportSchema.parse(input);
      const identity = mcpIdentity(process.env, process.cwd());
      if (!identity) throw new Error("OMP reporting has no factory attempt identity.");
      const missing = unreadable(report.assessment?.screenshots ?? []);
      if (missing.length) throw new Error(`Can't attach screenshots: ${missing.join("; ")}`);
      const at = Date.now();
      const stage: FactoryEvent = {
        kind: "builder_report",
        ...report,
        sessionId: identity.sessionId,
        jobKey: identity.jobKey,
        branch: identity.branch,
        eventId: createHash("sha256").update(`${identity.sessionId}\n${toolCallId}`).digest("hex"),
        at,
      };
      const events = [...screenshotEvents(report.assessment?.screenshots ?? [], {
        jobKey: identity.jobKey, stageEventId: stage.eventId, sessionId: identity.sessionId, at,
      }), stage];
      let delivery: string;
      try {
        const result = await reportEvents(events, 3000);
        delivery = !result ? "No ingest target configured." : result.error ? "Durably queued for delivery." : "Delivered.";
      } catch (error) {
        delivery = `Reporting failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      const verify = report.action === "progress"
        ? ` Before handoff, run factory-verify: bun "${join(import.meta.dirname, "hooks/verify.ts")}" --json. Use its sha and eventId in handoff.`
        : "";
      return { content: [{ type: "text", text: `Reported ${report.action}. ${delivery}${verify}` }], details: { action: report.action } };
    },
  });
}
