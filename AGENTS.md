# Repository Guidelines

## Project Overview

Marshal Factory turns Linear issues into agent-built pull requests. A Next.js supervision panel exposes job stages, evidence, spend, and owner decisions; a Bun runner executes jobs through T3 locally or in Modal sandboxes. Linear is the only shipped source adapter. Spend is measured, not capped.

## Architecture & Data Flow

1. Panel/Slack job creation files a Linear issue. Source webhooks and agent reports enter `functions/ingest/index.ts`.
2. `lib/ingest.ts` transactionally appends deduplicated events and updates Postgres projections. Session locks, attempt identity, and stage guards prevent stale reports from rolling state backward.
3. `runner/index.ts` consumes database intents through Neon Realtime plus polling/startup reconciliation. Realtime is a notification hint, not a complete event stream.
4. The runner claims jobs, launches T3 threads, manages sandboxes, reconciles stops, and writes results back through source adapters. Hooks/MCP send reports through a durable outbox.
5. The panel reads projections through owner-protected live endpoints and records actions as intents. Only `runner/merge-service.ts` performs GitHub merges.

Postgres is authoritative shared state. React realtime providers live inside the component tree, not at module scope, avoiding server-render sockets.

## Key Directories

- `app/`, `components/panel/`: App Router pages, server actions/API routes, and supervision UI. `components/ui/` holds shared UI primitives.
- `lib/`: domain logic and service boundaries; `lib/sources/` owns source integration, `lib/auth/` owner access, `lib/github/` GitHub App operations.
- `runner/`: machine orchestration, intent handling, launch/recovery, merge service, and sandbox lifecycle.
- `db/`, `drizzle/`: Drizzle schema/client and checked-in SQL migrations plus metadata.
- `functions/ingest/`, `hooks/`, `mcp/`: deployed ingest, agent lifecycle/verification hooks, and reporting MCP server.
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

`bun runner/index.ts` starts the daemon; `--once` performs operational reconciliation and exits. Neither is a read-only smoke check.

## Git Workflow

- Never edit code or commit directly on `main`, `master`, or any protected branch. Before changing files, check the current branch and existing local/remote branches relevant to the task.
- Reuse a relevant unprotected task branch when available. Otherwise, create and switch to a new branch named `<type>/<description>`, using a short kebab-case description, for example `feat/job-filter`, `fix/stale-events`, `chore/update-deps`, or `docs/branch-commit-rules`.
- Always commit completed changes after appropriate verification, before handing work back. Stage only task-related files; never include unrelated user changes. If verification or committing is blocked, report the exact blocker instead of claiming completion.
- After confirming a successful merge, delete the merged task branch both locally and on the remote. Switch off the task branch before deleting it; never delete `main`, `master`, protected branches, or unrelated branches. If the merge fails or is unconfirmed, keep the branch.

## Code Conventions & Common Patterns

- Strict TypeScript, ES modules, two-space indentation, double quotes, and semicolons. Follow adjacent code; use the root `@/*` alias and kebab-case module names.
- Keep source-specific code behind `SourceAdapter`. Call `sourceFor(job.source)`, `allSources()`, or `panelSource()` from `lib/sources`; do not import adapters or `lib/linear.ts` directly. ESLint enforces this, including literal dynamic imports and hard-coded source selection.
- Record an `approve_merge` intent instead of calling `mergePull`; ESLint reserves merge access for `runner/merge-service.ts`.
- Use `JobHost`/`hosts.forJob` for job commands/filesystem operations. Preserve injectable dependency objects and fake adapters used by regressions instead of hard-wiring external clients.
- Use shared `attemptBranch`/`parseBranch` helpers in `lib/factory.ts` and SQL helpers in `lib/branch-sql.ts`. Branches are `factory/<key>` and `factory/<key>-a<n>`; retries must remain attempt-isolated.
- Preserve event idempotency, monotonic usage, stage-transition validation, and atomic projection updates. Rejected transitions remain auditable without moving state.
- Runner queue errors are caught/logged; a queue timeout does not cancel underlying work. Preserve leases, pending markers, and overlap guards to avoid duplicate execution after ambiguous starts.
- Reporting hooks must not interrupt agent execution on delivery failure. Keep bounded outbox delivery separate from domain-action error handling.
- Maintain verified-owner authorization on panel operations; `FACTORY_OWNER_EMAILS` empty means no access. Slack endpoints use signature/timestamp validation and configured owner identity.

## Important Files

- `app/layout.tsx`, `app/(panel)/layout.tsx`: UI roots; `components/panel/realtime-root.tsx`: client subscriptions.
- `runner/index.ts`, `lib/ingest.ts`, `db/schema.ts`: orchestration entrypoint, event projections, persistence model.
- `lib/config.ts`: machine configuration validation; default file is `~/.config/marshal-factory/config.json`, overridable with `MARSHAL_FACTORY_CONFIG`.
- `eslint.config.mjs`, `tsconfig.json`: enforced architecture boundaries and compiler settings.
- `next.config.ts`, `neon.ts`, `vercel.json`: app, ingest/realtime, and deployment configuration. Vercel previews disable live updates.
- `drizzle.config.ts`, `scripts/migrate-guard.ts`: migration connection and production-branch protection.

## Runtime/Tooling Preferences

- Use **Bun 1.4.4** and `bun.lock`; do not introduce another package manager. Stack: Next.js 16, React 19, Tailwind 4, Drizzle/Postgres, Neon, and Modal.
- `.env.local` supplies local service credentials. Migrations require direct `DATABASE_URL_UNPOOLED`, not the pooled connection.
- Develop in a separate checkout/worktree and Neon branch. Installed hooks and the macOS LaunchAgent execute directly from the stable live checkout; never repurpose it for development.
- Vercel builds run migration guard, migrations, then build. Standalone `db:migrate` does not invoke that guard; verify the target before applying migrations.
- Installers, rollout, canary, deployed smoke scripts, and runner commands can mutate real services. Do not use them as routine validation or expose secrets in output.

## Testing & QA

- Tests are standalone Bun `scripts/*-regressions.ts` programs using `node:assert/strict`, fixtures, and injected fakes, not a Jest/Vitest suite.
- Run through `scripts/test-branch.ts`: it creates a temporary Neon branch, applies checkout migrations, runs selected scripts sequentially, and attempts deletion afterward. Requires authenticated `neon` CLI and `NEON_PROJECT_ID` or `.neon` project context; branches expire after two hours.
- Regressions write real database rows. Never bypass `scripts/test-guard.ts`, point them at normal app URLs, or manually fake harness markers.
- Choose filename-prefix suites covering changed behavior; preserve deterministic fixtures and attempt isolation. No numeric coverage threshold is configured.
- `hooks/verify.ts` verifies a target repository and reports commit-bound evidence; it is not this repository's regression harness. Canary creates a real issue/PR requiring manual closure; deployed ingest smoke scripts also write live events.
