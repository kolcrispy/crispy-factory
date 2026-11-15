# Runner-owned job phases and separate human attention

Replace agent-selected stages with Queued, Building, Reviewing, Ready, Done and Failed across persistence, reporting and clients. The runner owns phase transitions; builders report progress, explicit human needs and a commit-bound handoff rather than selecting job phases. Needs human is a separate actionable condition, preserving the phase while distinguishing owner intervention from ordinary CI or scheduling waits.

Independent review FIX returns to Building; BLOCKED and recoverable execution/publication errors retain their phase with human attention. Ready requires a published PR, not completed CI; Done requires confirmed merge. Review-disabled attempts may skip Reviewing. Stop confirmed or PR closed without merge ends Failed; retry creates another attempt from Queued. Existing independent review and exact-head merge gates remain authoritative.

The owner chose to reset only historical stage-transition records during the coordinated cutover, retaining jobs, attempts, sessions, independent reviews, evidence, spend, PRs and owner-action audits. Current state is mapped using execution/review facts; ambiguous recovery is held rather than inferred complete. Old reporters and runners must not run alongside the replacement contract.
