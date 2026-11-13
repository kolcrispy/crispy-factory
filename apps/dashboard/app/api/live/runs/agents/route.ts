import { pollingResponse, sessionAgentsQuery } from "../../../../../lib/live-queries";
import { sessionParam } from "@factory/core/run-links";

export async function GET(request: Request) {
  const sessionId = sessionParam(request);
  if (!sessionId) {
    return Response.json({ error: "invalid session id" }, { status: 400 });
  }
  return pollingResponse(sessionAgentsQuery(sessionId));
}
