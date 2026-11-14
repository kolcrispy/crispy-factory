export { ownerAccounts, ownerSessions, loginAttempts } from "./auth-schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { STAGES } from "@factory/core/events";
import type { AssessmentInput } from "@factory/core/assessment";
import type { CheckSource, EvidenceCheck, EvidenceSummary, Producer } from "@factory/core/evidence";
import type { Autonomy, MergeDecision } from "@factory/core/merge-decision";
import type { GithubSnapshot } from "@factory/core/github-snapshot";
import type { ScreenshotType } from "@factory/core/screenshots";
import type { Recipe } from "@factory/core/recipe";
import type { JobId, JobSource } from "@factory/core/sources/shapes";
import type { StopRecord } from "@factory/core/stop";
import type { AttemptReview, ReviewOverrides } from "@factory/core/review";


export const runStatus = pgEnum("run_status", ["active", "idle", "ended"]);
export const runStage = pgEnum("run_stage", STAGES);
export const agentStatus = pgEnum("agent_status", [
  "running",
  "completed",
  "failed",
]);

const ts = (name: string) => timestamp(name, { withTimezone: true });

const tokens = () => ({
  input_tokens: doublePrecision("input_tokens").notNull().default(0),
  output_tokens: doublePrecision("output_tokens").notNull().default(0),
  cache_read_tokens: doublePrecision("cache_read_tokens").notNull().default(0),
  cache_write_tokens: doublePrecision("cache_write_tokens")
    .notNull()
    .default(0),
});

export const events = pgTable(
  "events",
  {
    event_id: text("event_id").primaryKey(),
    session_id: text("session_id").notNull(),
    kind: text("kind").notNull(),
    at: ts("at").notNull(),
    // Set on stage events, so a job's stage history spans every session that worked on it.
    job_key: text("job_key"),
    payload: jsonb("payload").notNull(),
    /** Why ingest refused this stage event; null when the job and the run took it. */
    refusal: text("refusal"),
  },
  (t) => [
    index("events_session_at_idx").on(t.session_id, t.at),
    index("events_job_key_idx").on(t.job_key),
  ],
);

export const runs = pgTable(
  "runs",
  {
    session_id: text("session_id").primaryKey(),
    cwd: text("cwd"),
    repo: text("repo"),
    branch: text("branch"),
    job_key: text("job_key"),
    t3_thread_id: text("t3_thread_id"),
    role: text("role").$type<"builder" | "reviewer">().notNull().default("builder"),
    title: text("title"),
    status: runStatus("status").notNull().default("active"),
    stage: runStage("stage"),
    // Stage moves on its own clock: a stage report can land after a later turn_stop.
    stage_at: ts("stage_at"),
    stage_summary: text("stage_summary"),
    question: text("question"),
    pr_url: text("pr_url"),
    transcript_path: text("transcript_path"),
    started_at: ts("started_at").notNull(),
    last_event_at: ts("last_event_at").notNull(),
    model: text("model"),
    ...tokens(),
  },
  (t) => [index("runs_last_event_at_idx").on(t.last_event_at)],
);

export const agents = pgTable(
  "agents",
  {
    tool_use_id: text("tool_use_id").primaryKey(),
    session_id: text("session_id").notNull(),
    agent_id: text("agent_id").unique(),
    parent_agent_id: text("parent_agent_id"),
    subagent_type: text("subagent_type"),
    description: text("description"),
    model: text("model"),
    status: agentStatus("status").notNull().default("running"),
    started_at: ts("started_at").notNull(),
    ended_at: ts("ended_at"),
    ...tokens(),
  },
  (t) => [index("agents_session_idx").on(t.session_id)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey().$type<JobId>(),
    /** Jobs are created internally through authenticated dashboard or CLI submissions. */
    source: text("source").$type<JobSource>().notNull().default("internal"),
    external_id: text("external_id").notNull(),
    key: text("key").notNull().unique(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    description: text("description"),
    repo: text("repo").notNull(),
    writeback: jsonb("writeback").notNull(),
    source_state: jsonb("source_state").notNull(),
    stage: runStage("stage").notNull().default("queued"),
    stage_at: ts("stage_at"),
    stage_summary: text("stage_summary"),
    question: text("question"),
    pr_url: text("pr_url"),
    /** The stage event the job's stage came from; write-back keys its source comment on it. */
    stage_event_id: text("stage_event_id"),
    synced_event_id: text("synced_event_id"),
    /** Reply ids already handed to a thread; the replay guard for resumes. */
    delivered_reply_ids: jsonb("delivered_reply_ids").$type<string[]>().notNull().default([]),
    answered_at: ts("answered_at"),
    answer: text("answer"),
    /** The question and answer a relaunched thread gets when the original thread is gone. */
    resume_context: text("resume_context"),
    /** Each retry after a failure is a new attempt on its own branch. */
    attempt: integer("attempt").notNull().default(1),
    /** Why the previous attempt failed; the next attempt's first message quotes it. */
    previous_failure: text("previous_failure"),
    /** The owner's note for one attempt, from Retry in the inbox. Keyed by attempt, so a later attempt ignores a stale note and the claim need not clear it. */
    attempt_note: jsonb("attempt_note").$type<{ attempt: number; text: string }>(),
    /** Unused: the per-attempt cap it held was removed. Kept, with a default, for runners and ingest deployed before that. */
    /** When the watchdog nudged a stuck run, and in which stage; cleared once the stage moves on. */
    nudged_at: ts("nudged_at"),
    nudged_stage: runStage("nudged_stage"),
    /** The thread a stop message reached; a stop recorded before the thread was known waits for it. */
    stop_sent_to: text("stop_sent_to"),
    /** The stop recorded for this attempt. A later stage, such as a merge, leaves it, so an owed stop is still sent. */
    stop_event_id: text("stop_event_id"),
    /** Where the attempt's stop is on its way to a verified end; see lib/stop.ts. Null for a job never stopped. */
    stop: jsonb("stop").$type<StopRecord>(),
    /** The PR head the factory last sent back to its thread because it conflicted with main. */
    conflict_head: text("conflict_head"),
    t3_thread_id: text("t3_thread_id"),
    machine_id: text("machine_id"),
    /** The T3 provider instance and model this attempt's thread was launched with; null before a launch. */
    provider: text("provider"),
    model: text("model"),
    review_overrides: jsonb("review_overrides").$type<ReviewOverrides>(),
    attempt_review: jsonb("attempt_review").$type<AttemptReview>(),
    review_history: jsonb("review_history").$type<AttemptReview[]>().notNull().default([]),
    session_id: text("session_id"),
    /** The agent's assessment from its latest pr report on this attempt; rows from before the six checks were dropped keep that shape, so read it with parseAssessment. */
    merge_assessment: jsonb("merge_assessment").$type<AssessmentInput>(),
    /** The pr stage event merge_assessment came from; its screenshots are stored under it (job_screenshots). */
    assessment_event_id: text("assessment_event_id"),
    /** The runner's latest merge decision while the job sits in pr; see lib/merge-decision.ts. */
    merge_decision: jsonb("merge_decision").$type<MergeDecision>(),
    github_snapshot: jsonb("github_snapshot").$type<GithubSnapshot>(),
    /** The latest evidence for the current attempt, without output; job_evidence keeps every commit's. See lib/evidence.ts. */
    evidence: jsonb("evidence").$type<EvidenceSummary>(),
    /** When the owner dismissed the job from the inbox; a failure newer than this shows again. */
    dismissed_at: ts("dismissed_at"),
    /** Review feedback already handed to the thread, from the panel or GitHub; the replay guard for request_changes. */
    delivered_feedback_ids: jsonb("delivered_feedback_ids").$type<string[]>().notNull().default([]),
    /** When the owner archived the finished job off the panel; a stage newer than this shows it again. See lib/archive.ts. */
    archived_at: ts("archived_at"),
    archived_by: text("archived_by"),
    claimed_at: ts("claimed_at").notNull(),
    updated_at: ts("updated_at").notNull(),
  },
  (t) => [
    index("jobs_claimed_at_idx").on(t.claimed_at),
    check("jobs_id_check", sql`${t.id} = ${t.source}::text || ':' || ${t.external_id}`),
  ],
);


/**
 * The checks run at one commit of a job, from an evidence event (lib/evidence.ts). One row per job
 * and commit: a later run at the same commit replaces it, except that a run with uncommitted
 * changes never replaces a clean one, since it says nothing about the commit.
 */
export const jobEvidence = pgTable(
  "job_evidence",
  {
    job_key: text("job_key").notNull(),
    sha: text("sha").notNull(),
    attempt: integer("attempt").notNull(),
    repo: text("repo").notNull(),
    clean: boolean("clean").notNull(),
    producer: text("producer").$type<Producer>().notNull(),
    source: text("source").$type<CheckSource>().notNull(),
    checks: jsonb("checks").$type<EvidenceCheck[]>().notNull(),
    event_id: text("event_id").notNull(),
    recorded_at: ts("recorded_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.job_key, t.sha] }), index("job_evidence_job_recorded_idx").on(t.job_key, t.recorded_at)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Owner-uploaded job input images, shared by remote dashboard and local runner. */
export const jobImages = pgTable("job_images", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  content_type: text("content_type").notNull(),
  bytes: bytea("bytes").notNull(),
  uploaded_by: text("uploaded_by").notNull(),
  uploaded_at: ts("uploaded_at").notNull().defaultNow(),
});

/**
 * One screenshot a pr report's assessment attached (lib/screenshots.ts), keyed by that stage event
 * and the file it names, so the panel finds the current assessment's images from jobs.stage_event_id.
 */
export const jobScreenshots = pgTable(
  "job_screenshots",
  {
    stage_event_id: text("stage_event_id").notNull(),
    file: text("file").notNull(),
    job_key: text("job_key").notNull(),
    content_type: text("content_type").$type<ScreenshotType>().notNull(),
    bytes: bytea("bytes").notNull(),
    event_id: text("event_id").notNull(),
    recorded_at: ts("recorded_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.stage_event_id, t.file] }), index("job_screenshots_job_idx").on(t.job_key)],
);


export const intentKind = pgEnum("intent_kind", [
  "claim",
  "stop",
  "answer",
  "merged",
  "recheck_conflicts",
  "open_t3",
  "approve_merge",
  "request_changes",
  "close_job",
  "onboard_repo",
  "retry_stop",
  "review_action",
  "retry_job",
]);

/**
 * Durable dashboard, CLI, and runner requests. The runner executes each idempotently,
 * then records its result and handled_at. Repository registration uses onboard_repo;
 * open_t3 results contain a one-time pairing link, cleared on read or expiry.
 */
export const intents = pgTable(
  "intents",
  {
    id: text("id").primaryKey(),
    kind: intentKind("kind").notNull(),
    job_id: text("job_id").$type<JobId>(),
    pr_url: text("pr_url"),
    detail: text("detail"),
    created_at: ts("created_at").notNull(),
    handled_at: ts("handled_at"),
    attempts: integer("attempts").notNull().default(0),
    retry_at: ts("retry_at"),
    result: text("result"),
    /** The machine working on the intent; another machine may take it once lease_until has passed. */
    leased_by: text("leased_by"),
    lease_until: ts("lease_until"),
  },
  (t) => [index("intents_open_idx").on(t.handled_at, t.created_at)],
);

/** One row per machine that handled a broadcast intent, so each machine acts on it exactly once. */
export const intentReceipts = pgTable(
  "intent_receipts",
  {
    intent_id: text("intent_id")
      .notNull()
      .references(() => intents.id, { onDelete: "cascade" }),
    machine_id: text("machine_id").notNull(),
    handled_at: ts("handled_at").notNull(),
    result: text("result"),
  },
  (t) => [primaryKey({ columns: [t.intent_id, t.machine_id] })],
);

export const machines = pgTable("machines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  last_seen_at: ts("last_seen_at").notNull(),
  heartbeat: jsonb("heartbeat").notNull(),
  inventory: jsonb("inventory"),
  inventory_at: ts("inventory_at"),
});

/** Factory-wide settings the panel edits; the one row has id "factory". */
export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  /** The T3 provider instance new threads start on. */
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  review: jsonb("review").$type<ReviewOverrides>(),
  updated_at: ts("updated_at").notNull(),
  /** The owner's email. */
  updated_by: text("updated_by").notNull(),
});



/**
 * The repositories the factory works in, and per repo its merge policy and launch defaults; see
 * lib/repositories.ts. A repo with no row merges nothing and runs on Settings.
 */
export const repoSettings = pgTable(
  "repo_settings",
  {
    /** The GitHub full name, owner/name. */
    repo: text("repo").primaryKey(),
    registration_status: text("registration_status").$type<"pending" | "ready" | "failed">().notNull().default("pending"),
    registration_error: text("registration_error"),
    checkout_path: text("checkout_path"),
    default_branch: text("default_branch"),
    /** The name the panel and the Repository label show; null means the name part of repo. */
    display_name: text("display_name"),
    /** Where an issue without a Repository label goes; at most one row, and it must be enabled. */
    is_default: boolean("is_default").notNull().default(false),
    /** A disabled repo takes no new jobs; a Repository label naming it goes to the default. */
    enabled: boolean("enabled").notNull().default(true),
    /** The T3 provider instance this repo's jobs start on without a Harness label; null means Settings. */
    provider: text("provider"),
    /** Model override for the explicitly selected harness; null inherits its default. */
    model: text("model"),
    review: jsonb("review").$type<ReviewOverrides>(),
    /** Where this repo's jobs run without a Runs on label; null means Settings. */
    autonomy: text("autonomy").$type<Autonomy>().notNull().default("off"),
    /** Globs a PR may not touch to merge on its own; null means the defaults. */
    protected_paths: jsonb("protected_paths").$type<string[]>(),
    /** Most additions plus deletions a PR may have to merge on its own; null means the default. */
    max_changed_lines: integer("max_changed_lines"),
    /** Whether a PR waits for and is held to Bugbot's review; false for a repo without Bugbot. */
    require_bugbot: boolean("require_bugbot").notNull().default(true),
    /** Trusted recipe captured from the default branch during runner registration. */
    recipe: jsonb("recipe").$type<Recipe>(),
    updated_at: ts("updated_at").notNull(),
    updated_by: text("updated_by").notNull(),
  },
  (t) => [
    uniqueIndex("repo_settings_one_default_idx").on(t.is_default).where(sql`${t.is_default}`),
    check("repo_settings_default_enabled_check", sql`not ${t.is_default} or ${t.enabled}`),
  ],
);

export const auditAction = pgEnum("audit_action", ["merge_requested", "merge_succeeded", "merge_failed", "merge_decided", "override_fallback", "follow_up_filed", "review_dropped", "job_archived", "job_unarchived"]);
export const auditResult = pgEnum("audit_result", ["ok", "head_moved", "not_mergeable", "refused", "error"]);

/** Who asked the factory to change something outside it, and what happened. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    /** The owner's email from the session. */
    actor: text("actor").notNull(),
    action: auditAction("action").notNull(),
    job_id: text("job_id").notNull().$type<JobId>(),
    /** The PR URL. */
    target: text("target").notNull(),
    head_sha: text("head_sha").notNull(),
    /** Null on a request; set on its outcome. */
    result: auditResult("result"),
    /** GitHub's message, or why the panel refused. */
    detail: text("detail"),
  },
  (t) => [index("audit_log_job_at_idx").on(t.job_id, t.at)],
);

export type EventRow = typeof events.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type IntentRow = typeof intents.$inferSelect;
export type IntentKind = IntentRow["kind"];
export type MachineRow = typeof machines.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type RepoSettingsRow = typeof repoSettings.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;
export type JobEvidenceRow = typeof jobEvidence.$inferSelect;
