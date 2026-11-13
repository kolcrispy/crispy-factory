import { agentsOverviewQuery, pollingResponse } from "../../../../lib/live-queries";

export async function GET() {
  return pollingResponse(agentsOverviewQuery());
}
