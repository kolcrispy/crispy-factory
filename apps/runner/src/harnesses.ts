import type { Harness } from "@factory/core/harness";
import { readOmpHarness } from "./omp";

/** Runtime inventory comes directly from the installed OMP adapter. */
export async function readHarnesses(): Promise<Harness[]> {
  const omp = await readOmpHarness();
  return omp ? [omp] : [];
}
