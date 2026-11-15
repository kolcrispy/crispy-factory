# Review standards

Review cross-file contracts, not only the changed implementation:

- CLI, provider/model, lifecycle, or owner-action changes must agree with `.agents/skills/factory-jobs/SKILL.md`, shipped playbooks, and `docs/operations.md`. Skill parity proves distribution, not semantic correctness.
- Preserve attempt isolation, explicit ownership before recovery, uncertain-delivery holds, event idempotency, monotonic usage, and atomic projections. A timeout does not cancel underlying work.
- Keep execution dependencies injectable through `JobHost`/`hosts.forJob` and the existing execution seam. Avoid hard-wired external clients and speculative adapter frameworks.
- Keep reporting delivery failure separate from domain-action failure. Tools use the runner account's authority, not a sandbox.
- Repository cleanup needs positive ownership evidence. Preserve unrelated user files, sessions, credentials, and worktrees.

Mechanical architecture restrictions belong in `eslint.config.mjs`; migration/schema consistency belongs in `schema:check` and `schema-regressions.ts`. Do not substitute review prose for executable checks.
