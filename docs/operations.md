# Operating crispy-factory

Runtime reference for the local factory. PostgreSQL is authoritative shared state.

## Branding cutover

This release changes persistent runner and job-creation advisory-lock identities. Stop every old runner and dashboard before starting the renamed revision; mixed revisions do not share these locks. Wait for graceful runner shutdown and in-flight requests to settle. Do not reset the database for this branding-only change.

Rename custom environment overrides to `CRISPY_FACTORY_ENV` and `CRISPY_FACTORY_CONFIG` in service definitions and local environment files. Old override names are no longer read. Default config and state directories remain `~/.config/crispy-factory` and `~/.local/state/crispy-factory`.

On macOS, run the old checkout's `bun scripts/install-runner.ts --uninstall` before switching revisions, then install from the new checkout. The new LaunchAgent label is `com.crispy-factory.runner`; its installer does not unload an older label.

Reporting startup replaces the existing owned Codex MCP block even when its marker uses a previous product name. Existing PR decision comments remain historical; new comments use `<!-- crispy-factory:decision -->`. Git author identity for new automated reverts is `crispy-factory`. Existing jobs, attempts, and outbox files are retained.

## Runner

`bun apps/runner/src/index.ts` runs in the foreground. `--once` reconciles once and exits.

- **Ownership.** A dedicated PostgreSQL advisory-lock session prevents a second active runner. Losing the session stops the process.
- **Recovery.** Startup reconciliation and polling recover missed intents. Realtime notifications are hints, never the only path.
- **Shutdown.** SIGINT/SIGTERM stops scheduling, clears delayed rechecks, waits for queued and timed-out work, waits for verification races to settle, then stops the report server and releases ownership.
- **GitHub.** All API work goes through the runner's authenticated `gh`. The dashboard never holds credentials.
- **Execution.** Every attempt runs locally in an attempt-isolated `factory/<KEY>` or `factory/<KEY>-a<n>` worktree.
- **Reporting.** At startup the runner installs branch-guarded Claude Code hooks in `~/.claude/settings.json` and the `factory-report` MCP server in `~/.codex/config.toml`. Both files are merged idempotently and preserve unrelated settings. Committed target-repository files are never modified.

### Direct OMP harness

OMP runs directly, without a T3 server. Install and authenticate OMP under the runner account; optionally set `FACTORY_OMP_PATH` to its native executable. The runner advertises harness `omp` and provider-qualified models from the installed runtime. Select OMP per job, repository, or Settings. Existing defaults remain unchanged.

Factory creates a separate worktree and durable OMP session for every attempt under `~/.local/state/crispy-factory/omp`. Answers and feedback continue that session; retries create a different session. The runner checks process ownership and OMP session leases before reconnecting. Unknown ownership or uncertain prompt delivery holds recovery for inspection instead of creating duplicate work.

Only the explicitly trusted Factory reporting extension is loaded. OMP retains repository instructions and skills and uses its existing local credentials. Its unattended tools run with the runner user's permissions, not inside a security sandbox. `report_stage` delivers questions, stage transitions, and PR assessments through the durable outbox; factory-verify uses the same attempt identity. Shutdown aborts parent and subagents and waits for settlement before releasing ownership. OMP sessions have no Open in T3 link.

The existing `t3_thread_id` database column and `t3ThreadId` session-start field store the runner execution binding for both adapters. An `omp:<job>:<attempt>` binding is never a T3 thread id and is dispatched only to the direct adapter; this preserves existing stored T3 bindings without rewriting history. OMP subagent transcript identities are persisted before terminal snapshots disappear from the runtime registry, allowing cumulative usage reconciliation after restart.

## Jobs

Internal jobs are created by the dashboard or CLI and stored in PostgreSQL.

- `JOB-n` keys are assigned transactionally.
- A request id makes submission replay-safe.
- Retry creates a new attempt and preserves the previous failure, evidence, and usage.
- Answers are durable intents and succeed only when actually delivered to the thread. A refused delivery is explicit.
- Stop requests are driven to a verified confirmation; an unconfirmed stop waits for owner action.

## Repositories

Registration is asynchronous.

1. The dashboard stores a pending repository and an `onboard_repo` intent.
2. The runner validates push access and archived state, clones or adopts a checkout, and records the canonical name, default branch, and trusted `.factory/setup.json` recipe.
3. Only then does the repository become ready for jobs.

Repository settings include a default harness and optional default model. Models must belong to the selected enabled harness in runner inventory. Selecting Settings default clears the repository model override. With no model override, the Settings model applies when the harness matches Settings; a different harness uses its first reported model. Explicitly selecting the same harness on a job preserves the repository model; a different job harness uses its first reported model. Unavailable repository choices fall back to Settings at launch, while unchanged saved choices may be retained during unrelated edits.

The CLI `repositories save` JSON accepts `model` (a reported model slug or `null` to inherit) alongside `provider`. Apply migration `0050_lame_mandroid.sql` before running this revision of the dashboard or runner, then restart the runner. Existing repository rows inherit defaults through a null model.

A failed registration keeps its error on the row; replaying the same request is idempotent. Existing checkouts are adopted without resetting or cleaning user files.

## Dashboard

- Owner accounts and sessions live in PostgreSQL.
- `FACTORY_OWNER_EMAILS` empty means no dashboard owner access.
- Actions record durable intents; acceptance is not execution.
- Live endpoints expose projections only.
- A dashboard can be hosted remotely; it still never executes runner commands or receives GitHub credentials.

## Merging

- **Off** performs no merge evaluation.
- **Trial** evaluates and displays the decision but never merges.
- **Merge when confident** merges PRs that clear hard limits: checks green at the exact head, no conflicts, no unresolved Bugbot findings when required, and valid runner evidence.
- Every merge goes through `runner/merge-service.ts`.
- A failing post-merge watch may revert the factory's merge.
- Spend is measured, never capped.

## Evidence

The agent may report evidence, and the runner can independently verify the exact PR head in a fresh local worktree. A merge under trial/auto requires evidence for that commit. Verifications are bounded per job and globally, and shutdown waits for active runs before releasing ownership.

## Images

Uploaded job images are stored in PostgreSQL, served through owner-protected dashboard routes, and materialized by the runner outside the checkout under `.factory-inputs/<key>/<attempt>/`.

## Testing

```sh
export PATH="/path/to/postgresql/bin:$PATH"
FACTORY_TEST_POSTGRES_PORT=55440 bun scripts/test-postgres.ts <filename prefixes>
```

Each run uses a temporary PostgreSQL cluster. Never point regressions at the application database or bypass `scripts/test-guard.ts`.

## Migrations

```sh
bun run db:generate
bun run db:migrate
```

The local cutover requires a fresh database. Destructive migrations refuse populated legacy schemas instead of deleting user data.
