import { createHash } from "node:crypto";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { builderReportSchema, builderReportShape, type FactoryEvent, type BuilderReport } from "@factory/core/events";
import { REPORT_SERVER, REPORT_TOOL } from "@factory/core/factory";
import { reportEvents } from "@factory/core/outbox";
import { mcpIdentity, mcpPosts, type McpIdentity } from "@factory/core/report-identity";
import { screenshotEvents, unreadable } from "@factory/core/screenshot-files";

// Under Claude Code the PostToolUse hook (hooks/report.ts), which knows the session id, turns the
// accepted call into the stage event, so the tool only validates. Under any other harness the tool
// posts the event itself, through the outbox, for the job its env or its branch names.
const FLUSH_BUDGET_MS = 3000;
/** This checkout's factory-verify, which the playbook runs on the commit it pushes. */
const VERIFY_COMMAND = `bun ${join(import.meta.dirname, "..", "hooks/verify.ts")}`;
const VERIFY_HINT = `Verify the committed revision with \`${VERIFY_COMMAND} --json\` (factory-verify) in the worktree before handoff. The runner publishes it.`;
const server = new McpServer({ name: REPORT_SERVER, version: "0.1.0" });
let started = false;

function eventsFor(identity: McpIdentity, report: BuilderReport, at: number, opening: boolean): FactoryEvent[] {
  const { jobKey, branch, sessionId, repo } = identity;
  const stage: FactoryEvent = {
    eventId: createHash("sha256").update(`mcp\n${sessionId}\n${at}\n${JSON.stringify(report)}`).digest("hex"),
    sessionId,
    at,
    kind: "builder_report",
    ...report,
    jobKey,
    branch,
  };
  // The images go first, so the panel never shows an assessment whose screenshots haven't arrived.
  const images = screenshotEvents(report.assessment?.screenshots ?? [], { jobKey, stageEventId: stage.eventId, sessionId, at });
  if (!opening) return [...images, stage];
  // Opens the run and links it to the job; the same id from a restarted server is stored once.
  return [{ eventId: `mcp-start:${sessionId}`, sessionId, at, kind: "session_start", cwd: process.cwd(), branch, repo }, ...images, stage];
}

async function post(report: BuilderReport) {
  if (!mcpPosts(process.env)) return `Recorded ${report.action}.`;
  const identity = mcpIdentity(process.env, process.cwd());
  if (!identity) return `Report ${report.action} is valid, but this session has no factory attempt identity, so nothing was reported.`;
  const flushed = await reportEvents(eventsFor(identity, report, Date.now(), !started), FLUSH_BUDGET_MS);
  if (!flushed) return `Report ${report.action} is valid, but this machine has no factory ingest config, so nothing was reported.`;
  started = true;
  return flushed.error ? `Recorded ${report.action}; ingest did not answer, so it is queued for later delivery.` : `Recorded ${report.action}.`;
}

server.registerTool(
  REPORT_TOOL,
  {
    title: "Report factory work",
    description: "Report progress, needs_human with a concrete actionable question, or handoff with exact sha and evidenceEventId from factory-verify --json. Attach assessment only to handoff. The runner owns phases, review and PR publication. Never merge yourself.",
    inputSchema: builderReportShape,
  },
  async (input) => {
    const parsed = builderReportSchema.safeParse(input);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: parsed.error.issues.map((i) => i.message).join("; ") }],
      };
    }
    // Checked under every harness: under Claude Code the hook reads the same files once this call succeeds.
    const missing = unreadable(parsed.data.assessment?.screenshots ?? []);
    if (missing.length > 0) return { isError: true, content: [{ type: "text", text: `Can't attach the screenshots: ${missing.join("; ")}.` }] };
    // A reporting failure must never fail the call; the outbox keeps whatever was queued.
    const text = await post(parsed.data).catch((error: unknown) => `Report ${parsed.data.action} is valid, but delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    return { content: [{ type: "text", text: parsed.data.action === "progress" ? `${text} ${VERIFY_HINT} Pass its sha and eventId in handoff.` : text }] };
  },
);

await server.connect(new StdioServerTransport());
