# Headless factory with an optional dashboard

Accepted design direction, not a claim that the refactor is implemented. The factory must support bootstrap and all operational controls without the dashboard, with independent backend installation, builds, and deployment. Keep one Bun workspace and Postgres as authoritative state; retain T3 and existing execution behavior rather than replacing the executor during this refactor.

## Module and process responsibilities

- `apps/runner`: background execution, intent consumption, leases, recovery, watchdog, and job lifecycle.
- `apps/gateway`: hosted ingress for source webhooks, agent reports, and Slack endpoints, independent of Next.js deployment. It can continue accepting incoming events while the runner PC is offline.
- `apps/dashboard`: optional Next.js supervision and browser authentication. Its absence or failed build/deploy must not stop the backend.
- `apps/cli`: trusted operator controls, including repository onboarding, provider/model and execution configuration, required secrets, merge policy, notifications, answers/reviews, stop/retry, and merge approval. CLI operations need not reproduce dashboard views.
- `packages/core`: job rules and use cases shared by entry points, independent of React, Next.js, and application modules. A core module is not the background process.
- `packages/storage`: Postgres/Drizzle schema, migrations, persistence, and projections.
- `packages/integrations`: existing Linear, GitHub, T3, Modal, and Slack integrations.
- `packages/platform`: OS-specific identity, metrics, process invocation, and background installation.
- `packages/reporting`: hooks, MCP reporting, and durable outbox delivery.

This is the agreed target layout; internal interfaces must hide real behavior, not introduce pass-through wrappers. Applications compose dependencies; shared packages must not import application implementations. Preserve dependency injection and existing source/host seams.

## Control and trust

The CLI uses local configuration and trusted Postgres credentials to invoke the same core operations as other entry points. It does not require a new authenticated HTTP control backend or a running local runner merely to submit commands. This deliberately trusts operators holding database credentials; core authorization does not make unrestricted database credentials safe for untrusted clients.

Dashboard operations retain verified-owner authorization. Hosted ingress retains report-secret and webhook/Slack signature checks. The CLI must preserve state validation, actor attribution, audit records, and idempotency rather than bypassing domain rules. No public unauthenticated control endpoint is introduced.

Execution commands use durable database intents with request identity. Acceptance/queued status is distinct from completion; resubmitting the same request must not duplicate an action. Operators can inspect results and optionally wait. A wait timeout does not cancel accepted work. Existing synchronous operations need not be converted into intents without a behavioral reason.

## Deployment and migration

Keep runner, gateway, and dashboard configuration/credentials scoped to their responsibilities. The dashboard may query and submit operations through shared modules without routing every operation through the gateway. Runner execution continues to consume database intents rather than depending on direct dashboard-to-runner calls.

Storage owns schema migrations, run explicitly before backend deployments that require them. Dashboard build/deploy must no longer trigger migrations. Refactor incrementally with working entry points and clean cutovers, without permanent duplicate core implementations or compatibility aliases.

## Scope and acceptance

Preserve Linear as the shipped source, T3 execution, local and Modal execution, Slack, and current job/event/intent contracts. The development tracker under `.scratch/` is not a new factory job source. Native Windows support is a separate subsequent effort, not an acceptance requirement for this refactor.

With the dashboard shut down, verify bootstrap/onboarding, Linear intake, agent execution, commit-bound evidence, PR creation, answers/review feedback, stop/retry, merge approval, restart/recovery, and Slack operation. Preserve existing macOS/local/Modal behavior. Live verification must use isolated test repositories and database environments, not production jobs.

## Trade-offs

Direct database CLI access avoids a mandatory control server and browser login, at the cost of distributing powerful credentials and coupling the CLI to compatible storage/core versions. A hosted gateway remains necessary for incoming HTTP traffic; optional dashboard does not mean no backend endpoints. Independent entry points add build/deployment configuration, but prevent dashboard availability from determining factory availability.
