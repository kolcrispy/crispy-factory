# Direct OMP execution alongside T3

Accepted after owner review. Add OMP as a separate harness through a runner-local execution adapter instead of waiting for an upstream T3 provider or treating OMP as Pi. This revises ADR 0003's T3-only execution decision: T3-backed harnesses remain supported and existing defaults do not change; OMP jobs must not require a running T3 server.

## Execution contract

The runner uses the installed OMP executable and its local authentication and model configuration, with durable agent sessions isolated by job and attempt. Repository instructions and skills remain available; global extension discovery is disabled and Factory loads its reporting extension explicitly, without editing global OMP configuration or sending credentials to the dashboard. Tools run unattended with the runner account's permissions; worktrees provide change isolation, not a security sandbox.

The adapter covers launch, durable stage/question reporting, answer and feedback delivery, stop including subagents, usage/evidence, and recovery. Process exit is not evidence of successful work. Resume continues the same attempt only when session ownership is safe; ambiguous ownership holds the attempt for inspection rather than launching another agent. Retry creates a new attempt and session.

Factory retains PostgreSQL authority, exclusive runner ownership, attempt-isolated worktrees, gh-only GitHub actions, and merge authorization. Dashboard/CLI selection and model inventory distinguish OMP from T3-backed harnesses. Native Windows and Linux remain supported targets; verification records which actual runtimes were exercised.
