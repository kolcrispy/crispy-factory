# Operating crispy-factory

Runtime reference for the local factory. PostgreSQL is authoritative shared state.

## OMP-only cutover

OMP is the sole execution adapter. Migration `0059_omp_only_execution` renames execution bindings to `execution_id`; session-start events use `executionId`. T3 launch, pairing, inventory, hooks and MCP integration are removed. Do not run old processes against this schema. Preserve installed applications, credentials and existing user sessions.

For an explicitly authorized fresh start: verify code against an isolated database, identify the direct configured target without printing credentials, back it up, stop dashboard and runner gracefully, reset application schemas and apply checkout migrations. Keep services stopped until the operator provisions accounts and repositories. Never automatically reset on startup.

`bun scripts/cleanup-reporting.ts` explicitly removes only hooks pointing at this checkout and a marker-delimited MCP block whose executable arguments point at this checkout. It backs up changed configuration files and retains unrelated settings. Startup never installs or removes global integrations.


## Job lifecycle cutover

Migration `0058_loving_sunspot` replaces phases with Queued, Building, Reviewing, Ready, Done and Failed. Needs human preserves phase and records actionable intervention; CI and slot waits alone do not count. Only confirmed merge means Done. Recovery ambiguity holds work rather than declaring terminal failure.

Stop old runners and dashboards, reconcile owned sessions, then migrate before starting this revision. Do not mix old reporters with the new contract. OMP sessions must load the updated explicit extension. Reinstall Herdr and synchronize Factory skills. Preserve realtime pairing credentials and unrelated settings.

Builders use `report_work` actions progress, needs_human and handoff. Handoff names the exact SHA and evidence event ID from `factory-verify --json`; only clean successful current-attempt evidence is accepted. Builders do not choose phases or publish PRs, including review-disabled attempts. The runner publishes after a valid handoff and independent PASS when enabled. Ready may still await checks or owner approval. Review FIX clears the old handoff and returns Building; BLOCKED retains Reviewing with Needs human.

The migration removes only old stage events, retaining jobs, attempts, sessions, independent review history, evidence, screenshots, spend, PR references and owner audits. Current projections map from review/execution facts; unresolved attempts require inspection. Historical assessment IDs remain usable for retained screenshot evidence.

## Branding cutover

This release changes persistent runner and job-creation advisory-lock identities. Stop every old runner and dashboard before starting the renamed revision; mixed revisions do not share these locks. Wait for graceful runner shutdown and in-flight requests to settle. Do not reset the database for this branding-only change.

Rename custom environment overrides to `CRISPY_FACTORY_ENV` and `CRISPY_FACTORY_CONFIG` in service definitions and local environment files. Old override names are no longer read. Default config and state directories remain `~/.config/crispy-factory` and `~/.local/state/crispy-factory`.

On macOS, run the old checkout's `bun scripts/install-runner.ts --uninstall` before switching revisions, then install from the new checkout. The new LaunchAgent label is `com.crispy-factory.runner`; its installer does not unload an older label.

Existing PR decision comments remain historical; new comments use `<!-- crispy-factory:decision -->`. Git author identity for new automated reverts is `crispy-factory`. Existing jobs, attempts, and outbox files are retained unless a database reset is separately authorized.

## Dashboard development watcher

Tailwind scans only authored dashboard `app/` and `components/` sources. Keep generated `.next` output outside its source set: watching dev logs can create a rebuild/browser-reload feedback loop. Restart `bun run dev` after changing source detection so the previous watcher subscriptions are discarded.

## Development guardrails

`bun run check` runs lint, whole-project typecheck, Factory skill installation parity, and disposable PostgreSQL regressions. CI runs it on pull requests and main using Bun 1.4.4 and PostgreSQL 17. Generated Herdr `gpui-kit.d.ts` declarations describe a different runtime and are excluded from Bun/Node typechecking; validate that mod with `herdr-app check apps/herdr/mods/factory`.

`bun run typecheck` generates dashboard route types before compiling, so clean CI checkouts do not depend on a prior dashboard build or development server.

Install Chromium once with `bun x playwright install chromium`, then run `bun run smoke:dashboard`. This command provisions its own temporary PostgreSQL cluster, owner, repository/job fixtures, copied dashboard, free port, and browser. It checks authenticated Inbox, Settings, and Repositories for runtime errors and document reloads across polling and generated-log writes. Server exits fail the smoke. Owned child processes and runtime copies are cleaned up; the final screenshot stays under `.scratch/dashboard-smoke-evidence` (override with `FACTORY_SMOKE_ARTIFACTS`). No live dashboard, runner, credentials, or operational database is used. The browser smoke is skipped by the regular regression command and runs separately in CI.

Run detail's Merge confirmation closes immediately after confirmation. The durable approval stays queued for the runner; the Merge trigger shows pending work and notifications report completion or refusal while the detail remains open. Closing the dialog does not authorize a different SHA or bypass merge checks.

## Herdr native job controls

Reinstall with `bun apps/herdr/install.ts` after updating the checkout. Factory offers native New job and detail actions: answer, changes, merge, stop, retry, close, held-review recovery, archive and unarchive. Repository, model and account administration remain CLI/dashboard operations. New jobs inherit repository/global builder and independent-review policy; the preview is informational and claim resolves current policy.

Herdr invokes the trusted local CLI using structured argv and the configured checkout/Bun. It runs with the OS user's operator authority, not browser owner authentication. Do not share that OS account with untrusted users. SSE pairing remains read-only and grants no mutation permission. Briefs and feedback must not contain secrets.

Automatic job updates come only from SSE; Herdr has no periodic CLI refresh, including while disconnected. A one-time startup read and explicit Refresh can load jobs through the local CLI. New job loads defaults on opening. Selected-job controls update when its SSE projection changes; pending receipts reconcile on startup, changed job snapshots, or explicit Refresh. Offline data stays stale until reconnection or manual Refresh.

Merge confirms the displayed SHA; attempt-sensitive actions retain the displayed attempt and answers retain question identity. Runner merge/review/stop safeguards still apply. Offline acceptance means queued, not completed. Drafts are memory-only. Herdr home's `factory-pending-actions.json` retains only request/intent IDs and action metadata across reloads, outside the watched mod directory. Refresh inspects receipts without replaying mutations. For unknown outcomes, inspect CLI request status and job history before using Resolve inspected request and typing its UUID. Releasing a local hold neither cancels nor retries work; an original process can still finish. Never file a duplicate merely because a response was lost.
Successful Herdr actions clear their pending receipt without a completion banner or raw CLI JSON. Failed/refused and uncertain outcomes remain visible for operator recovery.



## Agent operations

The repository `.agents/skills/factory-jobs/` is authoritative. `bun run skills:sync` installs it to `~/.agents/skills/factory-jobs`; `--target <directory>` selects another installation. `bun run skills:check` proves a fresh installation is byte-identical; add `--target <directory>` to detect drift in an existing installation. Edit repository sources, then synchronize, rather than editing installed copies.

For agent investigations, use bounded service log tails rather than full transcripts. Read a complete relevant source block before patching it. On polling UI, refresh the browser snapshot before each ref-based action, or use stable semantic selectors. Prefer the smoke command over rebuilding fixture/startup/auth setup for each UI check.
Read only the relevant skill or source section; avoid batching whole large guides. For eval tool composition, import `checkedTool` from `scripts/agent-tools.mjs` using the absolute checkout path and wrap each tool call: `await checkedTool(tool.edit(args))`. It rejects both MCP-style `isError` and native `hasError`/`errorKind` envelopes. Never print credential-bearing tool results. After saving Herdr pairing, call `verifyRunnerCredential(path)` from the same helper; it authenticates with the saved file, not an in-memory token. This helper is available to repo-aware agents, not injected into the host runtime.



## Runner

`bun apps/runner/src/index.ts` runs in the foreground. `--once` reconciles once and exits.

- **Ownership.** A dedicated PostgreSQL advisory-lock session prevents a second active runner. Losing the session stops the process.
- **Recovery.** Startup reconciliation and polling recover missed intents. Realtime notifications are hints, never the only path.
- **Ready transitions.** Apply migration `0055_immediate_transitions` before restarting the runner. Committed job readiness changes, new intents, and terminal session reports notify the runner through PostgreSQL `LISTEN/NOTIFY`. Notifications coalesce into serialized reconciliation passes; a signal arriving during a pass schedules another pass. A clean, settled builder handoff prepares and launches its reviewer in the same pass. Polling remains the fallback for missed notifications and external changes without a report, including GitHub checks. Existing ownership, stop, attempt, launch-reservation, and uncertain-delivery guards still apply.
- **OMP status timeouts.** A timed-out `get_state` read leaves the review lifecycle unchanged and is retried by the next reconciliation pass. It does not imply prompt delivery failed or authorize publication, recovery, or another process. Prompt/repair delivery timeouts remain uncertain and require inspection. Provider stream errors remain visible in the durable OMP transcript.
- **Shutdown.** SIGINT/SIGTERM stops scheduling, clears delayed rechecks, waits for queued and timed-out work, waits for verification races to settle, then stops the report server and releases ownership.
- **GitHub.** All API work goes through the runner's authenticated `gh`. The dashboard never holds credentials.
- **Execution.** Every attempt runs locally in an attempt-isolated `factory/<KEY>` or `factory/<KEY>-a<n>` worktree.
- **Cleanup.** Startup and hourly cleanup remove finished builder and reviewer worktrees. Failed jobs retain the configured grace period. Reviewer cleanup includes prior-attempt review history and requires a registered checkout at the reviewed SHA, no uncommitted files, and confirmed stopped execution; unknown ownership holds it. Remote `factory/*` branches are deleted only when the PR merged at the exact current branch SHA, using a force-with-lease deletion to reject concurrent pushes. Already-absent remote branches need no action. Active, dirty or unmerged remote branches remain untouched.
- **Reporting.** Only the trusted explicit OMP extension reports agent actions. The runner does not modify user-level agent hooks or MCP servers.

### Realtime clients

Apply migration `0056_glamorous_revanche` before starting this revision. The runner serves a separate read-only client interface at `http://127.0.0.1:3009`; `factory.realtime.port` and `factory.realtime.origins` configure its port and explicitly allowed local HTTP browser origins. It is not the agent report endpoint, does not authorize job actions, and does not require the dashboard.

Generate a five-minute, single-use pairing code with `bun run cli realtime pair --input '{"label":"My browser"}'`. Enter the returned URL/code in the dashboard's **Connect runner** controls or Herdr's **Pair runner** controls. Browser credentials stay in sessionStorage for the tab session; Herdr stores its read-only token in `~/.config/herdr-app/mods/factory/realtime.json`. Reinstall the mod with `bun apps/herdr/install.ts` after updating its source. Treat pairing codes and client files as secrets. `bun run cli realtime clients` lists credential IDs without tokens; `bun run cli realtime revoke --input '{"id":"CLIENT-ID"}'` revokes one, including its active stream.

`POST /api/pair` exchanges `{code}` for `{id,token}`. Authenticated `GET /api/jobs` returns the version-1 snapshot; `GET /api/events` sends SSE `snapshot` events with the same body and a content revision in `id`. Use `Authorization: Bearer TOKEN`, never URL credentials. Snapshots contain the latest 200 jobs/runs, up to 1000 agents, machines, repository summaries, and per-attempt branch spend. Initial connection and reconnect always receive a complete snapshot. Missed transitions are not replayed; existing event/history endpoints remain the audit source. Heartbeat comments keep streams alive, slow clients disconnect instead of buffering indefinitely, and committed projection notifications drive updates independently of runner work scheduling.

Dashboard overview feeds stop polling while SSE is live; detail/history endpoints retain their existing reads. Both clients retain data and visibly mark a disconnected runner; dashboard database reads and Herdr CLI reads are the fallback. Local HTTP browser access only is supported, not remote/HTTPS dashboard-to-loopback deployment. CORS origin allowlisting and loopback Host validation apply in addition to token authentication.

### Direct OMP harness

Install and authenticate OMP under the runner account; optionally set `FACTORY_OMP_PATH` to its native executable. The runner advertises harness `omp` and provider-qualified models from the installed runtime. Harness selectors are hidden while OMP is the only adapter. Builder and reviewer model selection remains available; an empty builder model uses OMP's native default.

Factory creates a separate worktree and durable OMP session for every attempt under `~/.local/state/crispy-factory/omp`. Answers and feedback continue that session; retries create a different session. The runner checks process ownership and OMP session leases before reconnecting. Unknown ownership or uncertain prompt delivery holds recovery for inspection instead of creating duplicate work.
New execution IDs and session/worktree directories are scoped by the immutable job ID plus attempt, with reviewer round identity included. Display keys such as JOB-1 can repeat after a database reset and must never select a prior session. Durable records must match job ID, key, attempt and repository before launch reuse; recovery refuses mismatched or legacy unproven ownership. Preserve old records/transcripts. For an already collided attempt, stop it through the CLI and retry on a fresh attempt; do not resume the unrelated transcript or fabricate a handoff. Existing Git branches remain protected by Git's refusal to overwrite them.
Worktree preparation failures retain the launch reservation for inspection instead of cycling Building back to Queued. An undelivered reservation with no checkout retries Git preparation before any OMP spawn; an existing branch is never adopted or overwritten.



A started session with a missing transcript cannot resume. Status observation reports it gone only after the recorded process is dead and any known OMP session lease is confirmed free; live or unknown ownership remains an error. For a held reviewer, `jobs review` can then request a new review round without discarding builder evidence or reusing the broken session.

Only the explicitly trusted Factory reporting extension is loaded. OMP retains repository instructions and skills and uses its existing local credentials. Its unattended tools run with the runner user's permissions, not inside a security sandbox. `report_work` delivers progress, human needs and verified handoff through the durable outbox; factory-verify uses the same attempt identity. Shutdown aborts parent and subagents and waits for settlement before releasing ownership.

`execution_id` and the `executionId` session-start field bind an attempt to its owned adapter session. OMP subagent transcript identities persist before terminal snapshots disappear, allowing cumulative usage reconciliation after restart.

### Independent pre-PR review

Newly claimed attempts default to independent review. Enabled, harness, and model resolve independently from job, repository, then global settings; absent harness/model follow the builder. The claim snapshots policy. Running legacy attempts keep their old contract, and retries use current settings. Job detail and `jobs review-settings` edit future-attempt overrides only.

Builders implement, test, commit, run factory-verify and report handoff with its exact SHA and evidence event ID, then stop. They do not self-review or publish PRs. A fresh reviewer evaluates that commit in an isolated checkout without modifying source. PASS authorizes only that attempt and SHA. The runner pushes the approved SHA and creates the PR; merge also rechecks the approved SHA. Code changes require fresh handoff and review.

For review-enabled attempts, an exact-attempt, exact-head independent PASS replaces the legacy builder merge assessment in automatic merge eligibility. Legacy and review-disabled attempts still require their builder assessment. PASS does not bypass CI, trusted-check, verification, or conflict gates.

FIX requires substantive blocking findings and resumes the original builder. Automatic work is bounded to two repair cycles. BLOCKED, invalid results/configuration, failed sessions, uncertain delivery, and exhausted repairs hold the attempt in Needs you. Job detail or `jobs review` requests another review; `jobs review-changes` sends explicit owner changes. Owner recovery does not bypass PASS or reset the automatic repair allowance. Ambiguous launches reconcile only a uniquely identified original session and never launch a replacement blindly.

Review rounds remain in attempt history across retries. Reviewer runs carry role `reviewer`; their usage contributes to attempt totals and appears as role-specific session spend. Review is a report-only contract under runner account permissions, not an OS sandbox.

Rollout: stop the old runner, apply checkout migrations against the explicitly verified direct database target, then restart dashboard and runner. Do not mix schema-old processes with this revision. Migrations preserve existing jobs and default old run roles to builder.

## Jobs

Internal jobs are created by the dashboard or CLI and stored in PostgreSQL.

- `JOB-n` keys are assigned transactionally.
- A request id makes submission replay-safe.
- Retry creates a new attempt and preserves the previous failure, evidence, and usage.
- Answers are durable intents and succeed only when actually delivered to the thread. A refused delivery is explicit.
- Stop requests are driven to a verified confirmation; an unconfirmed stop waits for owner action.

### Manual GitHub issue import

In New job, paste a github.com issue URL and select **Load issue**. Loading only previews the title and description; edit them before filing. The repository is locked to the issue's registered, ready, enabled repository. Only open issues are accepted, not pull requests. Comments and external linked content are not imported. Submit rechecks issue status and access without overwriting edits.

The trusted CLI imports and immediately creates a job:

```sh
bun run cli jobs from-issue --input '{"url":"https://github.com/owner/repo/issues/123","requestId":"<uuid>"}'
```

The runner must be running on the same host as the dashboard/CLI: authenticated loopback lookup uses its `gh` credentials, including private repository access. Restart the runner after upgrading to this revision. Offline lookups fail without creating a job; there is no queued import, webhook, or automatic pickup. Replaying an accepted requestId returns the original job even after issue closure or runner shutdown. Use a new requestId for a new import.

Jobs store the original issue URL and a snapshot brief. Subsequent issue edits/closure do not update or stop the job. Concurrent imports of the same issue are rejected while any prior job is nonterminal; the error names that job. Done/failed jobs allow an explicit new import. The runner includes `Closes <issue URL>` in the published PR body so merge closes the issue. Import itself does not comment, label, or close the GitHub issue.


## Repositories

Registration is asynchronous.

1. The dashboard stores a pending repository and an `onboard_repo` intent.
2. The runner validates push access and archived state, clones or adopts a checkout, and records the canonical name, default branch, and trusted `.factory/setup.json` recipe.
3. Only then does the repository become ready for jobs.

Repository settings include a default harness and optional default model. Models must belong to the selected enabled harness in runner inventory. Selecting Settings default clears the repository model override. With an explicit repository harness and no model override, OMP uses the installed runtime's native default model, read through a fresh session without a prompt; other harnesses inherit the Settings model when matching Settings or otherwise use their first reported model. An explicit repository model overrides the native default. Explicitly selecting the same harness on a job preserves the repository model; a different job harness uses its runtime default when reported, otherwise its first reported model. Unavailable repository choices fall back to Settings at launch, while unchanged saved choices may be retained during unrelated edits. Existing attempts keep their recorded model; native default changes apply to new attempts after inventory refresh.

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
- **Merge when confident** merges PRs that clear hard limits: checks green at the exact head, no conflicts, and valid runner evidence.
- Every merge goes through `runner/merge-service.ts`.
- A failing post-merge watch may revert the factory's merge.
- Spend is measured, never capped.

Bugbot integration has been removed. Its GitHub check runs are excluded from Factory CI gates; independent review, non-Bugbot CI, verification and conflict checks still apply. Migration `0057_melodic_nehzno` drops the repository setting, deletes Bugbot-specific decision/snapshot event and failure audit records, and clears affected job merge projections for reevaluation. Jobs, attempts and verification evidence remain intact. GitHub installation, comments and checks are unchanged.

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
### Verified backup and reset

Run `bun scripts/database-maintenance.ts identify` first. It prints nonsecret server identity and authentication shape. Supply a direct URL; maintenance accepts only the `sslmode` query option so libpq cannot silently select a different target.

`bun run db:backup --backup <new-file.dump>` checks client/server major versions, refuses overwriting, verifies the custom archive with `pg_restore --list`, and writes a SHA-256/target manifest beside it. Select compatible binaries with `FACTORY_PG_DUMP` and `FACTORY_PG_RESTORE`, or use `--ssh <host-alias>` to run installed remote tools. Remote authentication fields travel over SSH stdin, never argv. On POSIX files use mode 0600; on Windows use a private user directory protected by its ACL. Archives contain application data and must remain private.

After explicit user authorization, gracefully stop runner/dashboard and other database clients. Run `bun run db:reset --backup <verified.dump> --services-stopped --confirm <host:port/database>`. Reset checks the manifest, hash, target identity, runner ownership lock, remaining client connections and unexpected schemas before dropping public/drizzle and applying checkout migrations. Keep services stopped. `--services-stopped` is an operator assertion, not a process discovery mechanism. Backup and reset are explicit operational commands, never routine validation.

`bun run schema:check` compares the latest journal snapshot with the TypeScript schema. Disposable `schema` regressions compare migrated tables, column types/nullability, constraint/index names and enum values; they do not prove every SQL expression equivalent. CI runs the check and a Windows evidence/OMP subset. Local Windows verification resolves Git Bash centrally through `packages/platform/src/shell.ts`; `FACTORY_BASH_PATH` overrides detection. System WSL bash is not used.


The local cutover requires a fresh database. Destructive migrations refuse populated legacy schemas instead of deleting user data.
