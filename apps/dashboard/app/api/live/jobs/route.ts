import { jobsQuery, pollingResponse } from "../../../../lib/live-queries";

export async function GET() {
  return pollingResponse(jobsQuery());
}
