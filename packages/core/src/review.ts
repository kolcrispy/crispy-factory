import { z } from "zod";
import type { Harness } from "./harness";
import type { HarnessChoice } from "./settings";

/** Null means inherit at repo/job scope, and Follow builder at global scope. */
export const reviewOverridesSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  provider: z.string().trim().min(1).nullable().optional(),
  model: z.string().trim().min(1).nullable().optional(),
});
export type ReviewOverrides = z.infer<typeof reviewOverridesSchema>;
export type ReviewPolicy = HarnessChoice & { enabled: boolean };

export function resolveReviewPolicy(builder: HarnessChoice, global?: ReviewOverrides | null, repo?: ReviewOverrides | null, job?: ReviewOverrides | null): ReviewPolicy {
  const layers = [job, repo, global];
  return {
    enabled: layers.find(layer => layer?.enabled != null)?.enabled ?? true,
    provider: layers.find(layer => layer?.provider != null)?.provider ?? builder.provider,
    model: layers.find(layer => layer?.model != null)?.model ?? builder.model,
  };
}

export function reviewConfigurationProblem(policy: ReviewPolicy, harnesses: readonly Harness[] | null): string | null {
  if (!policy.enabled) return null;
  const harness = harnesses?.find(value => value.id === policy.provider && value.enabled);
  if (!harness) return `Reviewer harness ${policy.provider} is not available.`;
  if (!harness.models.some(model => model.slug === policy.model)) return `Reviewer model ${policy.model} is not available on ${policy.provider}.`;
  return null;
}

export const reviewFindingSchema = z.object({
  severity: z.enum(["blocking", "suggestion"]),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  title: z.string().min(1),
  impact: z.string().min(1),
  reason: z.string().min(1),
});
export const reviewVerdictSchema = z.object({
  verdict: z.enum(["PASS", "FIX", "BLOCKED"]),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  summary: z.string().min(1),
  findings: z.array(reviewFindingSchema),
}).superRefine((value, context) => {
  const blocking = value.findings.some(finding => finding.severity === "blocking");
  if (value.verdict === "PASS" && blocking) context.addIssue({ code: "custom", message: "PASS cannot contain blocking findings." });
  if (value.verdict === "FIX" && !blocking) context.addIssue({ code: "custom", message: "FIX requires a concrete blocking finding." });
});
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type ReviewRound = {
  round: number;
  sha: string;
  base: string;
  threadId: string | null;
  sessionId: string | null;
  checkout: string | null;
  state: "pending" | "launching" | "running" | "complete" | "held";
  startedAt: number;
  result?: ReviewVerdict;
  error?: string;
};
export type AttemptReview = {
  attempt: number;
  policy: ReviewPolicy;
  state: "building" | "pending" | "reviewing" | "repairing" | "held" | "passed" | "skipped";
  builderThreadId: string | null;
  builderSessionId: string | null;
  automaticRepairs: number;
  rounds: ReviewRound[];
  delivery?: { id: string; state: "pending" | "uncertain" | "accepted"; message: string };
};

export function reviewAllowsPublication(review: AttemptReview | null, attempt: number, sha: string): boolean {
  if (!review) return true; // Attempts predating review retain their execution contract.
  if (review.attempt !== attempt) return false;
  if (!review.policy.enabled) return review.state === "skipped";
  const latest = review.rounds.at(-1);
  return review.state === "passed" && latest?.state === "complete" && latest.sha === sha && latest.result?.sha === sha && latest.result.verdict === "PASS";
}
