import { machinesQuery, pollingResponse } from "../../../../lib/live-queries";

export async function GET() {
  return pollingResponse(machinesQuery());
}
