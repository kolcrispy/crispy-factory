# Repository Guidelines

## Start here

Crispy Factory runs direct OMP attempts in isolated worktrees; PostgreSQL is authoritative. The dashboard is optional.

- Runtime, pairing, backup/reset, rollout and verification: read `docs/operations.md` before operational changes. Runner startup and `--once` mutate services.
- Review: read `CODING_STANDARDS.md`. When changing CLI/model/lifecycle/owner-action contracts, update `.agents/skills/factory-jobs/SKILL.md`, then run `skills:sync` and `skills:check`.
- Commands and tooling versions: `package.json`. Use Bun and `bun.lock`.


## Git Workflow

- Never edit code or commit directly on `main`, `master`, or any protected branch. Before changing files, check the current branch and existing local/remote branches relevant to the task.
- Reuse a relevant unprotected task branch when available. Otherwise, create and switch to a new branch named `<type>/<description>`, using a short kebab-case description, for example `feat/job-filter`, `fix/stale-events`, `chore/update-deps`, or `docs/branch-commit-rules`.
- Always commit completed changes after appropriate verification, before handing work back. Stage only task-related files; never include unrelated user changes. If verification or committing is blocked, report the exact blocker instead of claiming completion.
- After confirming a successful merge, delete the merged task branch both locally and on the remote. Switch off the task branch before deleting it; never delete `main`, `master`, protected branches, or unrelated branches. If the merge fails or is unconfirmed, keep the branch.



## Agent skills

### Issue tracker

Read `docs/agents/issue-tracker.md` before creating or reading tickets/specs; this repo uses local Markdown under `.scratch/`.

### Triage labels

Read `docs/agents/triage-labels.md` before triaging tickets; use the five default roles as local `Status:` values.

### Domain docs

Read `docs/agents/domain.md` before domain exploration; this repo uses single-context domain docs.
