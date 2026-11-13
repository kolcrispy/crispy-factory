"use server";

import { db } from "@factory/storage/client";
import { getOwner } from "../../lib/auth/server";
import type { JobId } from "@factory/core/sources/shapes";
import { requestPairing, takePairing, type PairingDeps } from "@factory/core/t3-pairing";

const deps: PairingDeps = {
  db,
  user: getOwner,
};

export async function requestT3Pairing(jobId: JobId) {
  return requestPairing(deps, jobId);
}

export async function takeT3Pairing(intentId: string) {
  return takePairing(deps, intentId);
}
