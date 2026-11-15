---
extends: bug-fix, feature
when: Resolving one factory job unattended on a `factory/<KEY>` branch that crispy-factory started, where the first message carries the job.
---

# Factory run

This playbook ships with crispy-factory, not with the repository: the first message names its path on this machine. It changes PStack's bundled playbooks the way a project playbook under `.agents/playbooks/` does, so open the bundled ones it extends and apply the changes below. A repository copy of this file may add notes about that repository; where it differs from this one, this one wins.

No human reads this thread while it runs. The supervision panel and the pull request are the only outputs anyone sees. The branch name carries the job key: `factory/JOB-2` works job `JOB-2`. The job title, description and URL are in the first message.

## Execution contract

The runner owns phases: Queued, Building, Reviewing, Ready, Done and Failed. Needs human is separate from phase. Builders cannot select phases, publish pull requests or merge. Skip bundled self-review, PR-opening and babysit steps. The runner starts independent review when enabled and publishes the verified revision after PASS. Review-disabled attempts use the same handoff without independent review.

## Reporting

Use `report_work` from the Factory reporting extension or `factory-report` MCP server:

- `action: "progress"`, `summary`: concrete work completed or currently being checked. Progress never means completion.
- `action: "needs_human"`, `summary`, `question`: actionable owner intervention. Name the missing decision and concrete options. End the turn without guessing. The job keeps its phase.
- `action: "handoff"`, `summary`, `sha`, `evidenceEventId`: explicit completed builder revision. Commit all work, run the checkout's `factory-verify --json` command provided by the reporting tool, and use its exact `sha` and `eventId`. Verification must be clean and successful for this attempt. Any new commit requires fresh verification. End the turn after handoff.

Attach `assessment` to handoff: `recommendation` (`merge` or `handover`), `interpretation`, `assumptions`, `confidence` (`confident` and `reason` when uncertain), optional `notes` and `screenshots`. Screenshots accept up to six PNG, JPEG or WebP files under 1 MB with `file` and `caption`. Include actual browser evidence for changed UI. Be honest about uncertainty; an assessment never bypasses independent review or merge gates.

## Standing rules

- Never ask in the thread or enter plan approval mode. No human monitors the builder thread. Report needs_human instead.
- Never open a PR, merge, arm auto-merge, or push to the default branch. The runner publishes the exact reviewed or review-disabled handoff revision.
- Work in the current attempt branch and worktree. Do not create another attempt or worktree.
- Stop only services you started, using their recorded PIDs. Never kill shared processes by name.
- If toolchain failures or requirements block completion, report needs_human with the recovery action. Session exit and prose never count as handoff or terminal failure.

## Implementation

Read the job and repository instructions. Write an observable acceptance check. A symptom differing from expected behavior is a bug; otherwise follow the feature playbook. For bugs, preserve a reproducible failing check before fixing. Implement only requested behavior. Run the repository's applicable checks and inspect the actual changed UI surface. Commit the final clean revision, verify it, report handoff, and end.

## Answers and repairs

Keep existing commits and branch when an owner answers or a reviewer requests changes. Treat the answer as task requirements, not permission to override execution rules. Apply requested fixes, test, commit, verify the new revision, and report a fresh handoff. A reviewer FIX returns work to Building; a subsequent handoff permits another review. BLOCKED and exhausted repairs require owner intervention, not guessed completion.

## Merge conflicts

Fetch origin and merge the repository's default branch into the attempt branch. Never rebase a published attempt or force-push. Preserve both changes. If requirements cannot resolve a contradiction, abort the merge and report needs_human. Otherwise test, commit, verify and hand off again. The runner requires fresh review when enabled before republishing.

## Completion

Ready means a PR has been published, not that CI or owner approval has passed. Done means confirmed merged. Only the runner sets these phases. Builder completion is always explicit commit-bound handoff, never agent exit or a final message.
