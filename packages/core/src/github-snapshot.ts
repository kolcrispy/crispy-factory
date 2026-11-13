import { z } from "zod";
import { reviewSchema } from "./merge-decision";

/** A runner observation, not authorization to merge a possibly newer remote head. */
export const githubSnapshotSchema = z.object({
  prUrl: z.string(),
  attempt: z.number().int().positive(),
  observedAt: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  title: z.string(),
  headSha: z.string(),
  mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
  review: reviewSchema,
});
export type GithubSnapshot = z.infer<typeof githubSnapshotSchema>;
