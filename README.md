# marshal-factory

An internal software factory: create a job in the dashboard or CLI, and a local runner executes it with T3 Code in an isolated git worktree, then opens a pull request with your authenticated `gh`.

PostgreSQL is authoritative. The dashboard only records commands and reads projections; it never runs `gh` and holds no GitHub credentials.

## Pieces

- `apps/dashboard/` - optional owner-protected Next.js supervision UI.
- `apps/runner/` - the single foreground executor. Owns T3, git, `gh`, repository preparation, recovery, merges, and evidence.
- `apps/cli/` - trusted operator access for owner provisioning and job control.
- `packages/reporting/` - Claude Code hooks and the `factory-report` MCP server.
- `packages/core/` - domain models, projections, and pure contracts.
- `playbooks/factory.md` - instructions every attempt follows.

## Requirements

- Bun 1.4.4, PostgreSQL 17, git, and GitHub CLI.
- T3 Code installed and running, with its CLI discoverable (`T3CODE_CLI_PATH` overrides).
- `gh auth login` completed on the runner machine.
- Linux or Windows. No service installer is required; run the runner in the foreground.

## Setup

```sh
bun install
cp .env.example .env.local
# Set DATABASE_URL and DATABASE_URL_UNPOOLED to a fresh database.
bun run db:migrate
```

Create the first owner account:

```sh
bun run cli owners create --input '{"email":"you@example.com"}'
```

Set `FACTORY_DASHBOARD_URL` when serving the dashboard. Production origins require HTTPS; loopback may use HTTP.

Configure the runner at `~/.config/crispy-factory/config.json` (override with `MARSHAL_FACTORY_CONFIG`):

```json
{
  "ingestUrl": "http://127.0.0.1:3008/ingest",
  "secret": "<at least 32 random characters>",
  "factory": {
    "workRoot": "/absolute/path/to/factory-work"
  }
}
```

The runner binds the report server to `127.0.0.1`, so never expose that port publicly.

## Run

```sh
bun apps/runner/src/index.ts
```

Only one runner may own an installation at a time; it holds a PostgreSQL advisory-lock session. On startup it reconciles missed work, registers configured checkouts, and wires reporting into the user-level Claude Code and Codex configuration. Hooks stay inert outside `factory/*` branches.

Dashboard:

```sh
bun run dev
```

Add a repository on `/repositories`. Registration is durable: the runner validates access, prepares a local checkout, and records its default branch and recipe before the repository becomes ready. New jobs on `/` are persisted immediately and start when the runner is online with capacity.

## Testing

```sh
export PATH="/path/to/postgresql/bin:$PATH"
FACTORY_TEST_POSTGRES_PORT=55440 bun scripts/test-postgres.ts
bun scripts/test-postgres.ts ingest new-job
```

The harness creates a disposable PostgreSQL cluster, applies migrations, runs guarded scripts sequentially, and removes the cluster. It never uses the application database.

## Security

- Owner authorization is verified for every dashboard action.
- The dashboard never executes `gh` or receives GitHub credentials.
- GitHub operations use the runner's local `gh` authentication.
- The report endpoint requires a secret of at least 32 characters and binds to loopback.
- Never commit `.env.local` or runner configuration containing secrets.

See `docs/operations.md` for runtime behavior.
