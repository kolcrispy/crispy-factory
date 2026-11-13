# Repository Guidelines

## Project Overview

Marshal Factory turns internally managed jobs into agent-built pull requests. An optional Next.js panel exposes stages, evidence, spend, and owner decisions; a single Bun runner executes T3-backed harnesses or direct OMP locally in attempt-isolated worktrees. Spend is measured, not capped.

## Architecture & Data Flow

1. Dashboard and trusted CLI create jobs in PostgreSQL and record durable control intents. Repository registration is prepared asynchronously by the runner.
2. `packages/core/src/ingest.ts` transactionally appends deduplicated events and updates Postgres projections. Session locks, attempt identity, and stage guards prevent stale reports from rolling state backward.
3. `apps/runner/src/index.ts` consumes intents through polling and startup reconciliation under an exclusive PostgreSQL advisory lock.
4. The runner claims jobs, launches agent sessions, reconciles stops and usage, and performs GitHub operations through its authenticated `gh`. Hooks, MCP, and the explicit OMP extension send reports through a durable outbox to the runner's loopback report server. There is no separate gateway.
5. The optional panel reads projections through owner-protected live endpoints and records actions as intents. Only `apps/runner/src/merge-service.ts` performs GitHub merges. The trusted operator CLI uses local database credentials without a dashboard account.

Postgres is authoritative shared state. Dashboard live endpoints poll projections; React providers remain inside the component tree.

## Key Directories

- `apps/dashboard/`: optional Next.js App Router UI, browser authentication, server actions, and live endpoints.
- `apps/runner/src/`: orchestration, intent handling, launch/recovery, reporting endpoint, merge service, and local runtime adapters.
- `apps/cli/src/`: trusted local operator commands and owner account provisioning.
- `packages/core/src/`: shared use cases and domain logic. `packages/integrations/src/`: GitHub/gh, T3, and OMP RPC clients. `packages/platform/src/`: host utilities.
- `packages/storage/src/`, `drizzle/`: Drizzle schema/client and SQL migrations. `packages/reporting/src/`: lifecycle hooks, reporting MCP server, and OMP extension.
- `scripts/`: guarded regression programs and operational utilities. `playbooks/` contains shipped agent instructions; `docs/operations.md` is the operational reference. Research notes/mockups are not implementation authority.

## Development Commands

```sh
bun install
bun run dev                     # Next.js development server
bun run build                   # Production application build
bun run start                   # Serve built application
bun run lint                    # ESLint
bun run test:regressions         # Full isolated regression harness
bun scripts/test-postgres.ts ingest new-job  # Filename-prefix subset
bun run db:generate              # Generate migrations from schema changes
bun run db:migrate               # Apply migrations to configured database
```

`bun apps/runner/src/index.ts` starts the foreground runner; `--once` performs operational reconciliation and exits. Neither is a read-only smoke check. `bun run cli --help` lists trusted operator commands. `bun run build:backend` builds runner and CLI without Next.js. Runner code changes require a process restart; harness inventory comes from the running process.

## Git Workflow

- Never edit code or commit directly on `main`, `master`, or any protected branch. Before changing files, check the current branch and existing local/remote branches relevant to the task.
- Reuse a relevant unprotected task branch when available. Otherwise, create and switch to a new branch named `<type>/<description>`, using a short kebab-case description, for example `feat/job-filter`, `fix/stale-events`, `chore/update-deps`, or `docs/branch-commit-rules`.
- Always commit completed changes after appropriate verification, before handing work back. Stage only task-related files; never include unrelated user changes. If verification or committing is blocked, report the exact blocker instead of claiming completion.
- After confirming a successful merge, delete the merged task branch both locally and on the remote. Switch off the task branch before deleting it; never delete `main`, `master`, protected branches, or unrelated branches. If the merge fails or is unconfirmed, keep the branch.

## Code Conventions & Common Patterns

- Strict TypeScript, ES modules, two-space indentation, double quotes, and semicolons. Use workspace package subpaths across packages, relative imports within a package, and kebab-case module names.
- Jobs use the internal source. Preserve shared job parsing and identity contracts in `packages/core/src/sources/`; external source adapters are not shipped.
- Record an `approve_merge` intent instead of calling `mergePull`; ESLint reserves merge access for `apps/runner/src/merge-service.ts`.
- Use `JobHost`/`hosts.forJob` for job commands/filesystem operations. Preserve injectable dependency objects and fake adapters used by regressions instead of hard-wiring external clients.
- Use shared `attemptBranch`/`parseBranch` helpers in `packages/core/src/factory.ts` and SQL helpers in `packages/core/src/branch-sql.ts`. Branches are `factory/<key>` and `factory/<key>-a<n>`; retries must remain attempt-isolated.
- Preserve event idempotency, monotonic usage, stage-transition validation, and atomic projection updates. Rejected transitions remain auditable without moving state.
- Runner queue errors are caught/logged; a queue timeout does not cancel underlying work. Preserve leases, pending markers, and overlap guards to avoid duplicate execution after ambiguous starts.
- OMP uses the installed runtime's credentials/models and an explicit trusted reporting extension, with global extension discovery disabled. Tools run with runner account permissions, not in a security sandbox. Session recovery must establish ownership before resuming; ambiguous prompt delivery holds the attempt rather than launching twice. See `docs/operations.md` and ADR 0004 for the execution contract.
- Reporting hooks must not interrupt agent execution on delivery failure. Keep bounded outbox delivery separate from domain-action error handling.
- Authorize dashboard operations through active PostgreSQL owner accounts and sessions. Provision/reset/disable accounts using the trusted CLI; dashboard transports cannot mint trusted operators. Production browser access requires HTTPS.

## Important Files

- `apps/dashboard/app/layout.tsx`, `apps/dashboard/app/(panel)/layout.tsx`: UI roots; `apps/dashboard/components/panel/realtime-root.tsx`: client subscriptions.
- `apps/runner/src/index.ts`, `packages/core/src/ingest.ts`, `packages/storage/src/schema.ts`: orchestration, projections, persistence.
- `packages/core/src/config.ts`: machine configuration; default file `~/.config/crispy-factory/config.json`, overridable with `MARSHAL_FACTORY_CONFIG`.
- `eslint.config.mjs`, `tsconfig.json`: architecture boundaries and compiler settings.
- `apps/runner/src/threads.ts`, `apps/runner/src/omp.ts`, `apps/runner/src/harnesses.ts`: shared lifecycle dispatch, direct OMP runtime, and combined harness inventory.
- `drizzle.config.ts`, `scripts/migrate-guard.ts`: migration connection and production-branch protection.

## Runtime/Tooling Preferences

- Use **Bun 1.4.4** and `bun.lock`; do not introduce another package manager. Stack: Next.js 16, React 19, Tailwind 4, Drizzle/Postgres.
- `.env.local` supplies local service credentials. Migrations require direct `DATABASE_URL_UNPOOLED`, not a transaction pooler. Remote database connections require verified TLS.
- Develop in a separate checkout/worktree and disposable PostgreSQL database. Live runner processes and installed reporting hooks use the stable checkout; never repurpose it for development.
- Dashboard builds never migrate. Explicit `bun run db:migrate` invokes the migration guard; verify the direct target before applying migrations.
- Installers, rollout, canary, deployed smoke scripts, and runner commands can mutate real services. Do not use them as routine validation or expose secrets in output.

## Testing & QA

- Tests are standalone Bun `scripts/*-regressions.ts` programs using `node:assert/strict`, fixtures, and injected fakes, not a Jest/Vitest suite.
- Run through `scripts/test-postgres.ts`: it creates a temporary PostgreSQL cluster, applies checkout migrations, runs selected scripts sequentially, and removes the cluster afterward. PostgreSQL 17 tools (`initdb`, `pg_ctl`) must be on PATH; choose a free port with `FACTORY_TEST_POSTGRES_PORT`.
- Regressions write real database rows. Never bypass `scripts/test-guard.ts`, point them at normal app URLs, or manually fake harness markers.
- Choose filename-prefix suites covering changed behavior; preserve deterministic fixtures and attempt isolation. No numeric coverage threshold is configured.
- `packages/reporting/src/hooks/verify.ts` verifies a target repository and reports commit-bound evidence; it is not this repository's regression harness. Runtime smoke checks must isolate state, reporting targets, repositories, and databases from live services.

## Agent skills

### Issue tracker

Read `docs/agents/issue-tracker.md` before creating or reading tickets/specs; this repo uses local Markdown under `.scratch/`.

### Triage labels

Read `docs/agents/triage-labels.md` before triaging tickets; use the five default roles as local `Status:` values.

### Domain docs

Read `docs/agents/domain.md` before domain exploration; this repo uses single-context domain docs.
