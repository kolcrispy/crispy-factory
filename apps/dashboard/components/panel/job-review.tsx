"use client";

import { useState, useTransition } from "react";
import type { JobRow } from "@factory/storage/schema";
import { reviewAction, saveReview } from "../../app/actions/review";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

import { Input } from "../ui/input";
export function JobReview({ job }: { job: JobRow }) {
  const review = job.attempt_review;
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [policy, setPolicy] = useState(job.review_overrides ?? {});
  // Future policy remains editable even before the first attempt starts.
  const act = (action: "review" | "changes") => start(async () => {
    try {
      const outcome = await reviewAction({ requestId: crypto.randomUUID(), jobId: job.id, attempt: job.attempt, action, body });
      setMessage(outcome.ok ? "Request queued for runner." : outcome.message);
      window.dispatchEvent(new Event("factory:refresh"));
    } catch { setMessage("Request failed. Check connection and retry."); }
  });
  return <section className="flex flex-col gap-3 rounded-lg border p-4" aria-label="Independent review">
    <h3 className="text-sm font-medium">Independent review: {review?.state ?? "not started"}</h3>
    <details className="text-sm"><summary>Review settings for next attempt</summary>
      <div className="flex flex-col gap-2 pt-2">
        <label>Review before PR<select aria-label="Job review policy" value={policy.enabled == null ? "inherit" : String(policy.enabled)} onChange={event => setPolicy({ ...policy, enabled: event.target.value === "inherit" ? null : event.target.value === "true" })}>
          <option value="inherit">Inherit</option><option value="true">Enabled</option><option value="false">Disabled</option>
        </select></label>
        <Input aria-label="Job reviewer harness" placeholder="Reviewer harness (empty inherits)" value={policy.provider ?? ""} onChange={event => setPolicy({ ...policy, provider: event.target.value || null })} />
        <Input aria-label="Job reviewer model" placeholder="Reviewer model (empty inherits)" value={policy.model ?? ""} onChange={event => setPolicy({ ...policy, model: event.target.value || null })} />
        <Button variant="outline" disabled={pending} onClick={() => start(async () => { try { const result = await saveReview({ jobId: job.id, review: policy }); setMessage(result.ok ? "Saved for next attempt; current review unchanged." : result.message); } catch { setMessage("Could not save review settings."); } })}>Save review settings</Button>
      </div>
    </details>
    {review && <p className="text-xs text-muted-foreground">{review.policy.provider} · {review.policy.model} · {review.automaticRepairs}/2 automatic repair cycles</p>}
    {[...job.review_history, ...(review ? [review] : [])].flatMap(attempt => attempt.rounds.map(round => <div key={`${attempt.attempt}:${round.round}`} className="flex flex-col gap-2 border-t pt-3 text-sm">
      <p className="font-medium">Attempt {attempt.attempt} · Round {round.round} · {round.result?.verdict ?? round.state} · {round.sha.slice(0, 8)}</p>
      {round.error && <p className="text-destructive">{round.error}</p>}
      {round.result && <><p>{round.result.summary}</p>{round.result.findings.map((finding, index) => <div key={index} className="rounded border p-2">
        <p>{finding.severity}: {finding.title}</p><code className="text-xs">{finding.file}{finding.line ? `:${finding.line}` : ""}</code>
        <p>{finding.impact}</p><p className="text-muted-foreground">{finding.reason}</p>
      </div>)}</>}
    </div>))}
    {review?.state === "held" && !job.stop && <>
      <Button variant="outline" disabled={pending} onClick={() => act("review")}>Run review again</Button>
      <Textarea aria-label="Requested builder changes" value={body} onChange={event => setBody(event.target.value)} placeholder="Describe changes for the builder" />
      <Button variant="outline" disabled={pending || !body.trim()} onClick={() => act("changes")}>Request changes</Button>
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
