import { readHarnesses as readT3Harnesses } from "@factory/integrations/t3-state";
import type { Harness } from "@factory/core/harness";
import { readOmpHarness } from "./omp";

/** Missing T3 configuration must not prevent a direct OMP job from launching. */
export async function readHarnesses(): Promise<Harness[]> {
  let t3: Harness[] = [];
  try { t3 = readT3Harnesses(); } catch { /* T3 is optional for direct harnesses. */ }
  const omp = await readOmpHarness();
  return [...t3.filter(h => h.id !== "omp"), ...(omp ? [omp] : [])];
}
