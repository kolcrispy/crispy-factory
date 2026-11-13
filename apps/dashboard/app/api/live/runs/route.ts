import { runsQuery, pollingResponse } from "../../../../lib/live-queries";

export async function GET() {
  return pollingResponse(runsQuery());
}
