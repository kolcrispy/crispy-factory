import { jobAuditQuery, jobIdForKey, parseJobKey, pollingResponse } from "../../../../../../lib/live-queries";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/live/jobs/[key]/audit">,
) {
  const key = parseJobKey((await params).key);
  if (!key) {
    return Response.json({ error: "invalid job key" }, { status: 400 });
  }
  const jobId = await jobIdForKey(key);
  if (!jobId) return Response.json({ error: "no such job" }, { status: 404 });
  return pollingResponse(jobAuditQuery(jobId));
}
