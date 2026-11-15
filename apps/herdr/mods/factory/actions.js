import { randomUUID } from "crypto";

const kinds = { answer: "answer", changes: "request_changes", stop: "stop", approve: "approve_merge", close: "close_job", retry: "retry_job", "retry-stop": "retry_stop" };
export const terminal = result => result.ok === false || ["done", "failed", "refused"].includes(result.status);
export const resultText = result => String(result.message || result.result?.error || JSON.stringify(result.result ?? result)).slice(0, 600);

/** Pending metadata never contains a brief, feedback, credentials, or a replayable mutation. */
export class Actions {
  constructor({ cli, load, save, changed }) {
    this.cli = cli; this.load = load; this.save = save; this.changed = changed;
    this.pending = []; this.busy = false; this.loaded = false; this.notice = "";
  }
  async restore() {
    const raw = await this.load();
    this.pending = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(this.pending) || this.pending.some(p => typeof p.requestId !== "string" || typeof p.action !== "string")) throw new Error("Invalid pending request journal; inspect factory-pending-actions.json before sending actions.");
    this.loaded = true;
    this.changed();
  }
  async persist() { await this.save(JSON.stringify(this.pending)); this.changed(); }
  async submit(action, input, label) {
    if (!this.loaded || this.busy || this.pending.some(p => p.jobId === (input.jobId ?? "new-job"))) throw new Error("Resolve the pending request before sending another action for this job.");
    const requestId = randomUUID();
    const item = { requestId, action, label, jobId: input.jobId ?? "new-job", attempt: input.expectedAttempt ?? input.attempt, headSha: input.headSha, status: "sending", at: new Date().toISOString() };
    if (kinds[action]) item.intentId = `panel:${kinds[action]}:${requestId}`;
    if (["review", "review-changes"].includes(action)) item.intentId = `review-action:${requestId}`;
    this.pending.push(item); this.busy = true;
    let dispatched = false;
    try {
      await this.persist();
      dispatched = true;
      const result = await this.cli("jobs", action, { ...input, requestId });
      if (result.intentId) item.intentId = result.intentId;
      if (result.ok === false || (!item.intentId && !result.status) || terminal(result)) {
        this.pending = this.pending.filter(p => p !== item);
        this.notice = `${label}: ${result.ok === false || ["failed", "refused"].includes(result.status) ? "refused/failed" : "completed"}. ${resultText(result)}`;
      } else { item.status = result.status ?? "queued"; this.notice = `${label}: accepted, waiting for runner.`; }
      await this.persist();
      return result;
    } catch (error) {
      if (!dispatched) { this.pending = this.pending.filter(p => p !== item); throw error; }
      item.status = "unknown";
      this.notice = `${label}: outcome unknown. Check status; do not submit again. ${error.message}`;
      await this.persist();
      throw error;
    } finally { this.busy = false; this.changed(); }
  }
  async release(requestId) {
    const item = this.pending.find(item => item.requestId === requestId);
    if (!item || item.status !== "unknown" || this.busy) return;
    this.pending = this.pending.filter(item => item.requestId !== requestId);
    await this.persist();
    this.notice = "Local pending hold released by operator. No mutation replayed or cancelled.";
  }
  async reconcile() {
    if (!this.loaded || this.busy) return;
    this.busy = true;
    try {
      for (const item of [...this.pending]) {
        let result;
        if (item.intentId) {
          result = await this.cli("requests", "show", { intentId: item.intentId });
          if (result.message === "No such request.") { item.status = "unknown"; continue; }
        } else if (item.action === "create") {
          const found = await this.cli("jobs", "show", { jobId: `internal:${item.requestId}` });
          if (!found.job) { item.status = "unknown"; continue; }
          result = { status: "done", message: `Filed ${found.job.key}.` };
        } else {
          const found = await this.cli("jobs", "show", { jobId: item.jobId });
          if (!found.job || Boolean(found.job.archived_at) !== (item.action === "archive")) { item.status = "unknown"; continue; }
          result = { status: "done", message: "Archive state confirmed." };
        }
        if (terminal(result)) {
          this.pending = this.pending.filter(p => p !== item);
          this.notice = `${item.label}: ${result.status}. ${resultText(result)}`;
        } else item.status = result.status ?? "queued";
      }
      await this.persist();
    } finally { this.busy = false; this.changed(); }
  }
}
