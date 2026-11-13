# Internal jobs and a local gh runner

Accepted after the owner confirmed the complete cutover contract. Factory owns jobs in PostgreSQL rather than mirroring Linear issues; dashboard and trusted CLI create jobs and record durable control intents. Remove Linear, Slack, GitHub App authentication, Modal, cloud onboarding/warm images, and the independently hosted public gateway instead of retaining parallel integration modes.

One active foreground runner uses its machine's authenticated `gh` CLI for every GitHub operation and executes T3 locally in attempt-isolated git worktrees. Linux is the primary runtime and native Windows is also supported; platform-specific process, launcher, and path behavior belongs at the runtime boundary, not in job logic. No systemd or Windows Service installer is required by this cutover.

The dashboard remains optional and may be hosted separately. It shares PostgreSQL with the runner, writes requests, and reads projections; it neither invokes runner-local tools nor receives the runner's GitHub token. Repository registration accepts owner/repo or a GitHub URL, then asynchronously becomes pending, ready, or failed after runner validation and checkout preparation. Local CLI registration may adopt an existing checkout without resetting or deleting user changes.

The runner owns an authenticated loopback-only agent reporting endpoint and durable report delivery. Removing public ingress must not remove evidence, auditability, lease protection, recovery, attempt isolation, or optional safe auto-merge/auto-revert. Preserve PostgreSQL owner accounts and session authentication from ADR 0002; remote browser access still requires HTTPS, and both runner and dashboard require connectivity to the same database.

Use a fresh database for this design. Historical Linear jobs need not be converted, but no existing database or user data is automatically deleted. This supersedes the external-source, public-gateway, and cloud-execution architecture in ADR 0001, while retaining its optional dashboard and explicit migration principles.

## Consequences

Without GitHub webhooks the runner reconciles PRs, reviews, and checks by polling. A disconnected runner leaves commands pending rather than making remote dashboard actions appear successful. Real Linux/Windows T3 and GitHub workflow verification remains necessary; injected regressions or successful builds alone do not establish live execution support.
