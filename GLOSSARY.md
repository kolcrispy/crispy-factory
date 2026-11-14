# Crispy Factory

Crispy Factory turns internally managed jobs into agent-built pull requests under human supervision.

## Language

**Owner**:
A person authorized to supervise factory work and approve consequential actions through an active owner account.
_Avoid_: administrator role, registered user

**Owner account**:
The managed identity granting an owner access to the supervision dashboard. Disabling it removes that access without rewriting earlier audit attribution.
_Avoid_: Neon user, allowlisted email

**Operator**:
A person trusted to administer the factory using its database credentials, including provisioning owner accounts. Operator access does not depend on a dashboard login.
_Avoid_: dashboard user

**Audit actor**:
The identity attributed to a recorded factory action. Historical attribution remains valid independently of the current account's existence or access.
_Avoid_: current owner

**Job**:
A factory-owned request to change a registered repository, including its instructions, progress, questions, and outcome.
_Avoid_: Linear issue, source issue

**Attempt**:
An isolated execution of a job. Retrying creates a new attempt without replacing the earlier execution's evidence.
_Avoid_: replacement run

**Repository registration**:
A request to make a repository available for factory work. Registration becomes ready only after access and local preparation succeed.
_Avoid_: sandbox onboarding

**Runner**:
The single active executor responsible for repository preparation, agent execution, recovery, and GitHub actions in an installation.
_Avoid_: cloud worker

**Intent**:
A durable request for the runner to perform an action, distinct from confirmation that the action succeeded.
_Avoid_: completed action

**Harness**:
The kind of agent runtime selected for a builder or reviewer, independently of the model it uses.
_Avoid_: model, T3 provider

**Agent session**:
The continuing conversation and execution history of one agent role within an attempt. Resuming continues that session; a new review round has a fresh reviewer session, while retrying creates a new attempt.
_Avoid_: job, replacement attempt

**Builder**:
The agent responsible for implementing a job, testing its changes, and addressing review findings.
_Avoid_: reviewer, self-reviewer

**Reviewer**:
An independent agent that evaluates a builder's proposed changes against the job requirements and reports findings without authoring fixes.
_Avoid_: builder, GitHub reviewer

**Review round**:
One independent evaluation of a particular revision within an attempt, ending in PASS, FIX, or BLOCKED. PASS permits publication of that revision; FIX requires changes, and BLOCKED requires an owner decision.
_Avoid_: retry, attempt
