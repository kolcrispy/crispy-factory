# Headless Factory with an Optional Dashboard

Status: ready-for-agent

## Problem Statement

The operator wants to install, configure, and run the factory in the background without using its web dashboard. The runner is already a separate process, but domain operations, browser authentication, persistence, realtime, and transport wiring share the same application structure. Slack endpoints and database migrations are tied to dashboard deployment. Merely closing the browser does not establish independent backend installation or deployment, and some operational controls still depend on the panel.

The operator needs complete headless control without replacing T3 or changing existing job behavior. Native Windows support is a subsequent project, not part of this refactor.

## Solution

Separate the factory into independently installable/buildable application entry points within one Bun workspace: a background runner, hosted gateway, optional dashboard, and trusted operator CLI. Share job rules and use cases through a framework-independent core, retain Postgres as authoritative state, and preserve existing intent-driven execution.

The CLI provides bootstrap and operational control through trusted local database credentials, without requiring a new HTTP control backend. The hosted gateway continues receiving source webhooks, agent reports, and Slack requests independently of the dashboard. Turning off or breaking the dashboard must not prevent job intake, execution, intervention, recovery, or result delivery.

## User Stories

1. As an operator, I want to install the runner without installing Next.js, so that the dashboard is optional in practice.
2. As an operator, I want to build and deploy the backend independently, so that a dashboard build failure cannot block backend updates.
3. As an operator, I want to run the factory as a background process, so that closing my browser does not interrupt jobs.
4. As an operator, I want to install and use a CLI without deploying a control server, so that trusted local administration stays simple.
5. As an operator, I want to bootstrap a fresh factory without the dashboard, so that initial setup is genuinely headless.
6. As an operator, I want to configure repositories and initiate onboarding from the CLI, so that new repositories do not require panel access.
7. As an operator, I want to inspect onboarding progress and provide required secrets without exposing their values, so that repositories can become ready safely.
8. As an operator, I want to select provider and model defaults without the dashboard, so that I can control agent execution headlessly.
9. As an operator, I want to configure local or Modal execution and repository defaults, so that jobs run in the intended environment.
10. As an operator, I want to configure merge policy and existing review requirements, so that headless operation does not change approval policy.
11. As an operator, I want to configure notifications and inspect their delivery results, so that I can stay informed without the panel.
12. As an operator, I want to create jobs through existing source filing behavior from the CLI, so that headless submission preserves Linear identity and write-back.
13. As an operator, I want to inspect jobs, attempts, machine readiness, questions, failures, and evidence, so that I can understand what needs intervention.
14. As an operator, I want to answer a waiting job from the CLI, so that work can continue without browser interaction.
15. As an operator, I want to request changes on an existing PR, so that the same job can address review feedback.
16. As an operator, I want to stop a job and inspect stop confirmation, so that accepted stop requests are not confused with terminated execution.
17. As an operator, I want to retry failed jobs and retry unconfirmed stops, so that recovery controls remain available headlessly.
18. As an operator, I want to approve a merge through the CLI, so that approval still flows through the runner's merge execution rules.
19. As an operator, I want to close or dismiss actionable inbox items and archive or unarchive jobs where supported, so that the headless workflow does not accumulate unmanageable state.
20. As an operator, I want execution commands accepted durably while the runner is offline, so that a temporary outage does not lose my decisions.
21. As an operator, I want accepted, queued, completed, and failed outcomes distinguished, so that command acceptance is not misreported as success.
22. As an operator, I want to inspect a command result or optionally wait for it, so that automation can follow operational progress.
23. As an operator, I want repeated submissions with the same request identity to be idempotent, so that retries do not duplicate actions.
24. As an operator, I want a CLI wait timeout to leave accepted work intact, so that transport timing does not silently cancel jobs.
25. As an operator, I want the runner to reconcile work after restart, so that dashboard availability is irrelevant to recovery.
26. As an operator, I want incoming webhooks and reports accepted while the runner PC is offline, so that execution downtime only delays processing.
27. As an operator, I want Slack commands and interventions available with the dashboard shut down, so that Slack remains an independent control surface.
28. As a dashboard user, I want existing owner-protected views and controls preserved, so that modularization does not remove the panel's behavior.
29. As an operator, I want actor attribution and audit records preserved across CLI, Slack, and dashboard operations, so that decisions remain accountable.
30. As an operator, I want explicit database migration execution separate from dashboard builds, so that deploying a UI does not mutate backend schema.
31. As a maintainer, I want existing local and Modal T3 execution preserved, so that architectural refactoring does not also replace the executor.
32. As a maintainer, I want one authoritative implementation of job rules shared by all entry points, so that clients cannot diverge on validation or transitions.
33. As a maintainer, I want isolated regression and end-to-end proof with the dashboard off, so that headless independence is demonstrated rather than inferred from directory layout.

## Implementation Decisions

- Follow the accepted architecture decision for headless operation and an optional dashboard. This spec describes target behavior, not functionality already implemented.
- Use one Bun workspace with separate runner, gateway, dashboard, and CLI applications. Backend applications must install and build without requiring Next.js; dashboard deployment is independently optional.
- Shared modules cover core use cases, storage, integrations, OS/platform behavior, and reporting. Applications compose dependencies; shared modules do not import application implementations. Split modules around real behavior and existing seams rather than creating pass-through wrappers.
- The core owns application rules and use cases, not a daemon or HTTP transport. It must not depend on React, Next.js, browser sessions, or OS-specific installers. Reuse existing injectable action dependencies, SourceAdapter, and JobHost seams.
- Keep Postgres authoritative and preserve existing job, event, attempt, stage, usage, evidence, audit, and intent contracts. No schema redesign is required by this decision; any necessary persistence additions must be justified by a concrete missing operational behavior and migrated explicitly.
- The runner owns background execution, intent consumption, leases, queueing, launch/recovery, watchdog, stop reconciliation, and merge execution. Preserve overlap guards and the distinction between timeout and cancellation.
- The hosted gateway owns source webhooks, agent reports, and Slack HTTP entry points. Preserve signature, timestamp, and report-secret validation. It must remain deployable and reachable independently of the dashboard.
- The dashboard remains an owner-authenticated client of shared query and command operations. It may access storage through shared modules; routing every operation through the gateway is not required.
- The CLI is for trusted operators holding database credentials. It invokes shared use cases directly, not an unauthenticated public endpoint or a mandatory local runner RPC interface. Database credentials constitute a powerful trust grant; this is not a multi-user isolation mechanism.
- Separate transport authentication from use-case authorization. Preserve owner checks for browser operations, trusted actor attribution for CLI operations, and existing Slack owner checks. No control surface may bypass state validation, audit behavior, or idempotency.
- Expose CLI commands for every operation necessary for bootstrap and daily operation, including repository onboarding, required secret provisioning, settings, policy, notifications, source filing, queries, answers, review feedback, stop/retry, approvals, and existing lifecycle controls. Reuse existing behavior rather than duplicating dashboard rendering or introducing a second source model.
- Execution commands persist durable intents using stable request identities. Distinguish acceptance from completion, make results inspectable, and support optional waiting. A wait timeout must not cancel accepted work. Preserve synchronous operations where the current contract requires them rather than converting everything into intents mechanically.
- Keep the merge operation centralized in the runner's existing merge module. CLI, Slack, and dashboard approvals record the appropriate intent instead of merging directly.
- Keep T3 as the execution integration, including session messaging, status, interruption, and recovery. Preserve both local and Modal execution and existing reporting/outbox behavior.
- Scope configuration and credentials by application responsibility. Preserve established secret handling: secret values must not appear in logs, command arguments, audit output, or result summaries; repository secrets remain in the existing secret store rather than factory records.
- Storage owns schema and migrations. Operators run migrations explicitly before backend deployments that require them. Remove migration execution from dashboard build/deploy workflows and migrate all associated operational callers and documentation.
- Carry out incremental working cutovers. Migrate all callers of moved interfaces and remove obsolete implementations/imports/configuration rather than retaining permanent compatibility aliases or duplicate core logic.
- Preserve the existing deployment capabilities of hosted ingest rather than requiring a new always-on gateway machine solely because the code is reorganized.

## Testing Decisions

- Test observable behavior through the highest existing use-case seam shared by operator controls; use the actual CLI as an additional consumer-facing proof. The test seams were explicitly approved by the operator.
- Good tests assert outcomes visible to operators or integrations: durable command acceptance, resulting state/source write-back, accurate completion/failure reporting, audit attribution, and absence of duplicate execution. Do not assert folder structure, wrapper calls, source text, or incidental wording as behavior.
- Prefer existing dependency injection, fake source adapters, fake hosts, and fake Modal implementations. Introduce new seams only when existing high-level seams cannot exercise required behavior.
- Preserve the standalone Bun regression style with strict assertions and schema-typed fixtures. Run database regressions through the existing isolated Neon branch harness and guards, using focused filename-prefix suites. Do not point regressions at a normal application database or forge harness markers.
- Prior art includes current ingestion, source/fake-source, inbox, new-job, settings, repository/onboarding, launch, lifecycle, stop/retry, realtime, outbox, owner, Slack, merge-decision, and migration-guard regressions. Move/adapt these contracts with the implementation rather than duplicating an entire suite.
- Exercise the shared command/query module through authorization, validation, request replay, attempt isolation, monotonic projections, and refusal auditing. Preserve the runner's lease, stale-report, and pending-launch safeguards.
- Test offline submission followed by runner processing; replay the same request and assert no duplicated action. Verify queued versus completed output and inspectable failure results. Prove that optional waiting timing out does not cancel persisted work.
- Launch the actual CLI for deterministic scenarios and inspect its output and exit status. Verify callers can distinguish accepted work, completed work, domain refusal, and execution failure without confusing a wait timeout with cancellation. Avoid exposing credentials in failures.
- Verify real backend install/build artifacts do not require installing or building Next.js. Verify dashboard build/deploy no longer applies migrations. Do not use source-text snapshots as proof of independent deployment.
- Verify dashboard authorization and Slack/report authentication remain enforced after extraction. Direct CLI access must still exercise domain validation and record its actor.
- Perform isolated live end-to-end acceptance with the dashboard shut down: fresh bootstrap and repository onboarding, Linear intake, T3 execution, commit-bound verification evidence, PR creation, answer/review feedback, stop/retry, merge approval, restart/recovery, and Slack interaction. Preserve local and Modal behavior on the existing supported runtime.
- Live verification must use designated test repositories, accounts/configuration, and database environments. Do not use production jobs or ordinary installer/rollout/canary commands as read-only smoke tests. Report unavailable external proof honestly; fake-based regressions alone do not establish complete live acceptance.

## Out of Scope

- Native Windows support, its background installer, OS metrics, process lifecycle, or cross-host path fixes beyond what is strictly needed to preserve the currently supported behavior. Track Windows as a subsequent effort.
- Replacing T3 with direct Claude Code/Codex execution or adding another execution backend.
- Replacing Postgres/Neon, introducing a message broker, or splitting this into independently versioned repositories or public microservices.
- Adding a new factory source adapter. The local Markdown development tracker is not a job intake source.
- Public unauthenticated controls, untrusted multi-user CLI access, or distributing restricted-user database access guarantees not provided by the current trust model.
- Dashboard redesign or reproducing all visualizations in the CLI.
- Removing existing functionality, changing merge policy, weakening owner authorization, imposing spend caps, or silently narrowing acceptance to a happy-path launch.

## Further Notes

The accepted design is recorded in ADR-0001, “Headless factory with an optional dashboard.” It deliberately trades direct database CLI coupling and powerful operator credentials for avoiding a mandatory HTTP control backend. CLI and storage/core versions must therefore be deployed compatibly.

“Headless” means the dashboard is not required; it does not mean the system has no HTTP endpoints or external dependencies. Runner downtime delays execution, while hosted ingress can continue accepting incoming traffic when its dependencies remain available.

This specification is published to the configured local Markdown tracker with the ready-for-agent triage status. It is an implementation contract, not a report that the refactor or its acceptance checks have already been completed.
