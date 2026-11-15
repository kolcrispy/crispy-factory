import { join } from "node:path";
import { cleanupHarnessReporting } from "@factory/runner/reporting-cleanup";

const outcome = cleanupHarnessReporting(join(import.meta.dirname, "../packages/reporting/src"));
console.log(JSON.stringify(outcome));
if (outcome.failed.length) process.exitCode = 1;
