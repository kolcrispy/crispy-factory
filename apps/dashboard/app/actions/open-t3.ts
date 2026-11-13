"use server";

import { db } from "@factory/storage/client";
import { auth } from "../../lib/auth/server";
import type { JobId } from "@factory/core/sources/shapes";
import { requestPairing, takePairing, type PairingDeps } from "@factory/core/t3-pairing";

const deps: PairingDeps = {
  db,
  user: async () => (await auth.getSession()).data?.user,
};

export async function requestT3Pairing(jobId: JobId) {
  return requestPairing(deps, jobId);
}

export async function takeT3Pairing(intentId: string) {
  return takePairing(deps, intentId);
}
