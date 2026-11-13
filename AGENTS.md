# Repository Guidelines

## Project Overview

Marshal Factory turns Linear issues into agent-built pull requests. A Next.js supervision panel exposes job stages, evidence, spend, and owner decisions; a Bun runner executes jobs through T3 locally or in Modal sandboxes. Linear is the only shipped source adapter. Spend is measured, not capped.

## Architecture & Data Flow

1. CLI/Panel/Slack job creation files a Linear issue. Source webhooks and agent reports enter `apps/gateway/src/index.ts`.
2. `packages/core/src/ingest.ts` transactionally appends deduplicated events and updates Postgres projections. Session locks, attempt identity, and stage guards prevent stale reports from rolling state backward.
3. `apps/runner/src/index.ts` consumes database intents through Neon Realtime plus polling/startup reconciliation. Realtime is a notification hint, not a complete event stream.
4. The runner claims jobs, launches T3 threads, manages sandboxes, reconciles stops, and writes results back through source adapters. Hooks/MCP send reports through a durable outbox.
5. The optional panel reads projections through owner-protected live endpoints and records actions as intents. Only `apps/runner/src/merge-service.ts` performs GitHub merges. The trusted operator CLI uses local database credentials without a dashboard account.

Postgres is authoritative shared state. React realtime providers live inside the component tree, not at module scope, avoiding server-render sockets.

## Key Directories

- `apps/dashboard/`: optional Next.js App Router UI, browser authentication, server actions, and live endpoints.
- `apps/runner/src/`: machine orchestration, intent handling, launch/recovery, merge service, and sandbox lifecycle.
- `apps/gateway/src/`: independent hosted ingest, source webhooks, and signed Slack endpoints. `apps/cli/src/`: trusted local operator commands.
- `packages/core/src/`: shared use cases and domain logic. `packages/integrations/src/`: source, GitHub, T3, Modal, and Slack clients. `packages/platform/src/`: host utilities.
- `packages/storage/src/`, `drizzle/`: Drizzle schema/client and SQL migrations. `packages/reporting/src/`: lifecycle hooks and reporting MCP server.
- `scripts/`: guarded regression programs and operational utilities. `playbooks/` contains shipped agent instructions; `docs/operations.md` is the operational reference. Research notes/mockups are not implementation authority.

## Development Commands

```sh
bun install
bun run dev                     # Next.js development server
bun run build                   # Production application build
bun run start                   # Serve built application
bun run lint                    # ESLint
bun run test:regressions         # Full isolated regression harness
bun scripts/test-branch.ts ingest new-job  # Filename-prefix subset
bun run db:generate              # Generate migrations from schema changes
bun run db:migrate               # Apply migrations to configured database
```

`bun apps/runner/src/index.ts` starts the daemon; `--once` performs operational reconciliation and exits. Neither is a read-only smoke check. `bun run cli --help` lists trusted operator commands. Backend-only installation: `bun install --filter @factory/runner --filter @factory/cli --filter @factory/gateway --production --frozen-lockfile`; `bun run build:backend` builds these apps without Next.js.

## Git Workflow

- Never edit code or commit directly on `main`, `master`, or any protected branch. Before changing files, check the current branch and existing local/remote branches relevant to the task.
- Reuse a relevant unprotected task branch when available. Otherwise, create and switch to a new branch named `<type>/<description>`, using a short kebab-case description, for example `feat/job-filter`, `fix/stale-events`, `chore/update-deps`, or `docs/branch-commit-rules`.
- Always commit completed changes after appropriate verification, before handing work back. Stage only task-related files; never include unrelated user changes. If verification or committing is blocked, report the exact blocker instead of claiming completion.
- After confirming a successful merge, delete the merged task branch both locally and on the remote. Switch off the task branch before deleting it; never delete `main`, `master`, protected branches, or unrelated branches. If the merge fails or is unconfirmed, keep the branch.

## Code Conventions & Common Patterns

- Strict TypeScript, ES modules, two-space indentation, double quotes, and semicolons. Use workspace package subpaths across packages, relative imports within a package, and kebab-case module names.
- Keep source-specific code behind `SourceAdapter`. Call `sourceFor(job.source)`, `allSources()`, or `panelSource()` from `@factory/core/sources/index`; only source composition and adapters import concrete integrations. ESLint enforces this, including literal dynamic imports and hard-coded source selection.
- Record an `approve_merge` intent instead of calling `mergePull`; ESLint reserves merge access for `apps/runner/src/merge-service.ts`.
- Use `JobHost`/`hosts.forJob` for job commands/filesystem operations. Preserve injectable dependency objects and fake adapters used by regressions instead of hard-wiring external clients.
- Use shared `attemptBranch`/`parseBranch` helpers in `packages/core/src/factory.ts` and SQL helpers in `packages/core/src/branch-sql.ts`. Branches are `factory/<key>` and `factory/<key>-a<n>`; retries must remain attempt-isolated.
- Preserve event idempotency, monotonic usage, stage-transition validation, and atomic projection updates. Rejected transitions remain auditable without moving state.
- Runner queue errors are caught/logged; a queue timeout does not cancel underlying work. Preserve leases, pending markers, and overlap guards to avoid duplicate execution after ambiguous starts.
- Reporting hooks must not interrupt agent execution on delivery failure. Keep bounded outbox delivery separate from domain-action error handling.
- Maintain verified-owner authorization on panel operations; `FACTORY_OWNER_EMAILS` empty means no access. Slack endpoints use signature/timestamp validation and configured owner identity.

## Important Files

- `apps/dashboard/app/layout.tsx`, `apps/dashboard/app/(panel)/layout.tsx`: UI roots; `apps/dashboard/components/panel/realtime-root.tsx`: client subscriptions.
- `apps/runner/src/index.ts`, `packages/core/src/ingest.ts`, `packages/storage/src/schema.ts`: orchestration, projections, persistence.
- `packages/core/src/config.ts`: machine configuration; default file `~/.config/marshal-factory/config.json`, overridable with `MARSHAL_FACTORY_CONFIG`.
- `eslint.config.mjs`, `tsconfig.json`: architecture boundaries and compiler settings.
- `apps/dashboard/next.config.ts`, `apps/dashboard/vercel.json`, `neon.ts`: dashboard and independent gateway deployment. Vercel previews disable live updates.
- `drizzle.config.ts`, `scripts/migrate-guard.ts`: migration connection and production-branch protection.

## Runtime/Tooling Preferences

- Use **Bun 1.4.4** and `bun.lock`; do not introduce another package manager. Stack: Next.js 16, React 19, Tailwind 4, Drizzle/Postgres, Neon, and Modal.
- `.env.local` supplies local service credentials. Migrations require direct `DATABASE_URL_UNPOOLED`, not the pooled connection.
- Develop in a separate checkout/worktree and Neon branch. Installed hooks and the macOS LaunchAgent execute directly from the stable live checkout; never repurpose it for development.
- Dashboard builds never migrate. Explicit `bun run db:migrate` invokes the migration guard; verify the direct target before applying migrations.
- Installers, rollout, canary, deployed smoke scripts, and runner commands can mutate real services. Do not use them as routine validation or expose secrets in output.

## Testing & QA

- Tests are standalone Bun `scripts/*-regressions.ts` programs using `node:assert/strict`, fixtures, and injected fakes, not a Jest/Vitest suite.
- Run through `scripts/test-branch.ts`: it creates a temporary Neon branch, applies checkout migrations, runs selected scripts sequentially, and attempts deletion afterward. Requires authenticated `neon` CLI and `NEON_PROJECT_ID` or `.neon` project context; branches expire after two hours.
- Regressions write real database rows. Never bypass `scripts/test-guard.ts`, point them at normal app URLs, or manually fake harness markers.
- Choose filename-prefix suites covering changed behavior; preserve deterministic fixtures and attempt isolation. No numeric coverage threshold is configured.
- `packages/reporting/src/hooks/verify.ts` verifies a target repository and reports commit-bound evidence; it is not this repository's regression harness. Canary creates a real issue/PR requiring manual closure; deployed ingest smoke scripts also write live events.

## Agent skills

### Issue tracker

Read `docs/agents/issue-tracker.md` before creating or reading tickets/specs; this repo uses local Markdown under `.scratch/`.

### Triage labels

Read `docs/agents/triage-labels.md` before triaging tickets; use the five default roles as local `Status:` values.

### Domain docs

Read `docs/agents/domain.md` before domain exploration; this repo uses single-context domain docs.
