import type { JobRow } from "@factory/storage/schema";
import type { JobId, JobSource, SourceStateOf, WritebackOf } from "./shapes";

export type { JobId, JobSource } from "./shapes";

export type Job<S extends JobSource = JobSource> = Omit<JobRow, "id" | "source" | "writeback" | "source_state"> & {
  id: JobId<S>;
  source: S;
  writeback: WritebackOf<S>;
  source_state: SourceStateOf<S>;
};

export type ImageFile = { filename: string; contentType: string; bytes: Uint8Array<ArrayBuffer> };
export type FiledJob = { key: string; url: string };
