---
name: factory-jobs
description: "File work into Crispy Factory as jobs that a local runner implements end to end in an isolated worktree and returns as a pull request. Use this skill whenever the user wants an agent to implement, fix, refactor, migrate, test, or investigate something in a registered repository and expects a PR: 'file this', 'delegate this', 'buatkan job', 'masukin ke factory', 'jalanin di factory', 'kerjain pakai runner', mentions JOB- or the Factory dashboard, or asks what work is queued. Also use it before any Factory CLI command, including read-only ones, so repository resolution, duplicate checks, job briefs, and owner-only actions follow the documented contract."
compatibility: "Bun 1.4.4 and a Crispy Factory checkout with its .env.local database credentials. The runner must be online to execute jobs."
---

# Factory jobs

Crispy Factory turns a written job into an unattended agent attempt: isolated worktree, verification, pull request. The job description is the *entire* brief that agent receives, so vague text becomes a failed or wrong attempt. Your value here is not typing a CLI command; it is turning intent into a brief that survives without you.

## A submitted job is real work

`jobs create` writes to shared Postgres, wakes the runner, starts model spend, and creates a branch and PR. Treat it like starting a deployment, not like saving a note.

Submit only when the user clearly asks for the work to be done. "What do you think about adding X", "could we refactor Y", or a discussion of a plan is not authorization. If the intent is ambiguous, draft the brief and show it; do not submit.

Never write SQL, call dashboard endpoints, or drive the forms. The CLI is the only supported surface. Never answer, approve, merge, close, retry, or stop a job unless the user asked for that specific action on that job: those are owner decisions with external effects. In particular, `jobs approve` merges the pull request.

## Invocation

The CLI lives in the Factory checkout and needs that checkout's `.env.local`.

```sh
FACTORY_HOME="${FACTORY_HOME:-D:/Projects/Programming/crispy-factory}"
bun run --cwd "$FACTORY_HOME" cli <resource> <action> --input '<json>'
```

`bun run --cwd` matters: it loads the checkout's environment and workspace packages. Run `bun run --cwd "$FACTORY_HOME" cli --help` when you need the current command list. Secrets belong in the environment, never in argv.

Exit codes: `0` success, `1` refused/failed (read the JSON message), `2` accepted but still pending. Code `2` is not a failure; keep the same request id and check the intent later.

## Before writing the job

Run these read-only checks and actually read the output.

```sh
bun run --cwd "$FACTORY_HOME" cli repositories list
bun run --cwd "$FACTORY_HOME" cli jobs list
bun run --cwd "$FACTORY_HOME" cli machines list   # only when picking a harness
```

### 1. Resolve the repository

The create call needs `repo` unless the user wants the default. Resolve in this order:

1. The repository the user named.
2. The current checkout's `origin` remote, when that repository is registered. This is the common case: the user is sitting in the repo and says "file this".
3. The registered default, only when the conversation is genuinely about that default and no other repo is in play.

Never silently fall back to the default when the user is working in a different repository. Filing into the wrong repo produces a plausible PR in the wrong codebase, which is worse than asking.

If the intended repo is not registered, say so and ask. Registration clones or adopts a checkout and validates push access, so run it only when the user asks:

```sh
bun run --cwd "$FACTORY_HOME" cli repositories add \
  --input '{"repo":"owner/name"}' --wait 90
```

Until registration reports `ready`, the repository cannot take jobs.

Use only repositories with `registration_status: "ready"` and `enabled: true`.

### 2. Check for duplicate or overlapping work

Compare the requested change against jobs that are `queued`, `running`, `waiting`, or `pr`. If one already covers it, report that job and ask whether to add context to it instead of filing a second job that races the first. A genuinely different change is fine; two jobs touching the same files are not.

### 3. Pick the harness only when it matters

`provider` is a harness instance id, not a model slug. Omit it to let Settings decide.

A model name is not a provider. Do not put a model slug in `provider`, and do not refuse the job just because no harness advertises that model: omit `provider`, submit, and say the harness and Settings choose the model. Refuse only when the user requires a specific harness that is not enabled; `machines list` shows which harnesses are available.

## Write the brief

Aim for concrete and short: usually 150-600 words. The executing agent cannot see this conversation, so restate the facts it needs. Include:

- **Goal**: the outcome in one or two sentences.
- **Context**: symptoms, stack traces, file paths, links, and what you already ruled out.
- **Scope and non-goals**: what must change and what must not. This is where you prevent drive-by refactors.
- **Acceptance criteria**: observable behavior, not "works correctly".
- **Verification**: the exact commands or checks that prove it. If the repo has none, say what a reviewer should run.
- **Constraints**: compatibility, dependency policy, data migrations, style, performance budgets.

Do not paste the whole conversation. Distill it. Do not include tokens, cookies, customer data, or anything that would be unsafe in a PR, a database row, and a transcript. State uncertainty explicitly; an unattended agent cannot ask mid-course unless it reports a question.

Title: an imperative phrase naming the change, under ~70 characters, specific enough to identify the PR.

### Example brief

```markdown
## Goal
Stop the billing page from crashing when an invoice has more than 50 line items.

## Context
`app/billing/invoice.tsx` renders every line item in one list. Sentry issue BILL-412 shows
`RangeError: Maximum call stack size exceeded` from `formatTotals` on invoices with 51+ items.
Reproduced locally with `bun test app/billing/invoice.test.tsx -t "large invoice"`.

## Scope
- Paginate or virtualize the line-item list; keep the totals summary visible.
- Do not change invoice data shape or the API response.

## Acceptance criteria
- A 250-line invoice renders without crashing and the first page shows 50 items.
- Keyboard navigation reaches the next page control.
- Existing invoice tests still pass.

## Verification
`bun test app/billing` and `bun run lint`.

## Constraints
No new dependencies. Keep the current design tokens.
```

## Submit

Generate a UUID request id, build valid JSON (JSON strings cannot contain raw newlines), and pipe it in. `jq` handles escaping; if it is unavailable, build the object with Bun.

```sh
FACTORY_HOME="${FACTORY_HOME:-D:/Projects/Programming/crispy-factory}"
REQUEST_ID=$(bun -e 'console.log(crypto.randomUUID())')
BRIEF=/tmp/factory-job.md   # write the markdown brief here first

jq -n --arg requestId "$REQUEST_ID" \
      --arg repo "acme/web" \
      --arg title "Paginate invoice line items to stop large-invoice crashes" \
      --rawfile description "$BRIEF" \
      '{requestId:$requestId, repo:$repo, title:$title, description:$description}' |
  bun run --cwd "$FACTORY_HOME" cli jobs create --stdin
```

Add `"provider":"omp"` only when a specific harness is required. Successful output looks like:

```json
{ "ok": true, "identifier": "JOB-1", "url": "/list?job=JOB-1" }
```

`ok: true` means *filed*, not done. A job can still fail to start.

Replay rules: if the result is unknown (timeout, dropped connection), retry the same JSON with the same `requestId`; that is idempotent. If any field changes, use a new request id. Never file a second job just because the first is slow.

## Report back

Give the job key, repository, and dashboard link (`${FACTORY_DASHBOARD_URL:-http://localhost:3000}` + the returned `url`). Describe what happens next and who acts: the runner starts it, the agent may ask a question through the inbox, and the pull request waits for the owner's review unless repository autonomy allows merging.

Do not claim completion from a queued job. When the user asks for status, read it:

```sh
bun run --cwd "$FACTORY_HOME" cli jobs show --input '{"jobId":"JOB-1"}'
bun run --cwd "$FACTORY_HOME" cli inbox list
```

Stages: `queued`, `running`, `waiting` (a question or decision needs the owner), `pr` (reviewable), `merged`, `failed`.

## Owner actions

Each durable action takes a UUID `requestId` and prints an intent id. Add `--wait 60` when the user wants the outcome now.

| Command | Effect |
| --- | --- |
| `jobs answer` | Send the answer text to a waiting job |
| `jobs changes` | Send review feedback; the same attempt continues |
| `jobs approve` | Merge the reviewed head. Irreversible; only on explicit request |
| `jobs close` | Close the PR and fail the job |
| `jobs retry` | Start another attempt of a failed job |
| `jobs stop` | Interrupt the running attempt |
| `jobs archive` / `unarchive` | Hide or restore a finished job |
| `jobs follow-up` | File a fix when a post-merge revert failed |

Example:

```sh
bun run --cwd "$FACTORY_HOME" cli jobs answer \
  --input '{"jobId":"JOB-1","requestId":"<uuid>","body":"Use the existing pagination helper."}' --wait 60
```

On exit code `2`, inspect with:

```sh
bun run --cwd "$FACTORY_HOME" cli requests show --input '{"intentId":"<intent-id>"}'
```

Reusing the same request id safely replays a lost response; it does not repeat the side effect.

## Failure messages

| Message | Meaning | Next step |
| --- | --- | --- |
| `Only the factory owner can start jobs.` | CLI is not using a trusted operator identity | Check the checkout and database environment; do not retry blindly |
| `Choose an enabled repository before starting a job.` | Repo missing, pending, or disabled | List repositories; register it only if the user asked |
| `No machine reports an enabled harness <id>.` | Wrong provider id or runner offline | List machines; omit `provider` or report the gap |
| `This request ID belongs to another repository registration.` | Reused request id with different content | New UUID |
| `not a job id: ...` | `jobs show` got something other than `JOB-n` or an internal id | Use the key from `jobs list` |

## Keep jobs coherent

One job should be reviewable as one change. Split independent work, and keep unrelated cleanup out of the brief. If the user asks for something that spans repositories, file separate jobs and say why. If the request is underspecified to the point where acceptance criteria cannot be written, ask the user for that missing fact before spending an agent attempt.
