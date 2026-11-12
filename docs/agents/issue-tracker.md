# Issue tracker: Local Markdown

Issues and specs live in `.scratch/`, not GitHub Issues or the application's Linear integration.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- Spec: `spec.md` inside that directory.
- Tickets: `issues/<NN>-<slug>.md`, numbered from `01`; one file per ticket.
- Triage: a `Status:` line near the top, using `docs/agents/triage-labels.md`.
- Append conversation under `## Comments`.

## Skill operations

- Publish a spec: write `.scratch/<feature-slug>/spec.md`.
- Publish a ticket: create its numbered file under `issues/`.
- Fetch a ticket: read the referenced path; resolve a bare number within the feature directory.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`, with Notes, Decisions-so-far, and Fog.
- Children: numbered issue files with `Type: research|prototype|grilling|task`.
- Blockers: `Blocked by: NN, NN`; unblocked when all listed tickets are resolved.
- Track wayfinding lifecycle separately as `Progress: open|claimed|resolved`; reserve `Status:` for triage roles.
- Frontier: first numbered open, unblocked, unclaimed ticket.
- Claim: save `Progress: claimed` before work.
- Resolve: append `## Answer`, set `Progress: resolved`, and add a gist plus relative link to Decisions-so-far in the map.
