import { z } from "zod";

export type SourceShape = { label: string; writeback: z.ZodType; sourceState: z.ZodType };


const internal = {
  label: "Factory job",
  writeback: z.object({}),
  sourceState: z.object({
    actor: z.string(),
    requestedProvider: z.string().optional(),
  }),
};

const SHIPPED = { internal } satisfies Record<string, SourceShape>;

/** Internal PostgreSQL job identity namespace. */
export type JobSource = keyof typeof SHIPPED;

export const SOURCE_SHAPES: { [S in JobSource]: (typeof SHIPPED)[S] } = SHIPPED;

export const isRegisteredSource = (name: string): name is JobSource => Object.hasOwn(SOURCE_SHAPES, name);

export type WritebackOf<S extends JobSource> = z.infer<(typeof SOURCE_SHAPES)[S]["writeback"]>;
export type SourceStateOf<S extends JobSource> = z.output<(typeof SOURCE_SHAPES)[S]["sourceState"]>;
export type SourceStateDraftOf<S extends JobSource> = z.input<(typeof SOURCE_SHAPES)[S]["sourceState"]>;

export type JobId<S extends JobSource = JobSource> = `${S}:${string}`;

export const jobId = <S extends JobSource>(source: S, externalId: string): JobId<S> => `${source}:${externalId}`;

export function parseJobId(value: string): { id: JobId; source: JobSource; externalId: string } {
  const colon = value.indexOf(":");
  const source = value.slice(0, colon);
  if (colon < 1 || !isRegisteredSource(source)) throw new Error(`not a job id: ${value}`);
  return { id: value as JobId, source, externalId: value.slice(colon + 1) };
}

export const sourceLink = (job: { source: JobSource; url: string }) => ({ label: SOURCE_SHAPES[job.source].label, href: job.url });
