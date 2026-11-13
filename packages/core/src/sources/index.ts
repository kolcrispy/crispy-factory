import type { JobRow } from "@factory/storage/schema";
import { isRegisteredSource, jobId, SOURCE_SHAPES } from "./shapes";
import type { Job } from "./types";

export { jobId } from "./shapes";
export const isJobSource = isRegisteredSource;

export function parseJob(row: JobRow): Job {
  if (!isRegisteredSource(row.source)) throw new Error(`Unsupported job source ${row.source}; use a fresh internal factory database.`);
  const shape = SOURCE_SHAPES[row.source];
  const id = jobId(row.source, row.external_id);
  if (row.id !== id) throw new Error(`Job ${row.key} has an invalid identity.`);
  return { ...row, id, writeback: shape.writeback.parse(row.writeback), source_state: shape.sourceState.parse(row.source_state) };
}
export const parseJobs = (rows: readonly JobRow[]) => rows.map(parseJob);
