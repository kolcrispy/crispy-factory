import { jobEvidenceQuery, parseJobKey, pollingResponse } from "../../../../../../lib/live-queries";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/live/jobs/[key]/evidence">,
) {
  const key = parseJobKey((await params).key);
  if (!key) {
    return Response.json({ error: "invalid job key" }, { status: 400 });
  }
  return pollingResponse(jobEvidenceQuery(key));
}
