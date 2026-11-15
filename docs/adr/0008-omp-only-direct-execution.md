# OMP-only direct execution

Supersedes the dual-runtime compatibility decision in ADR 0004. Factory executes only through the installed OMP runtime, retaining a concrete execution-adapter seam for future direct adapters rather than a plugin framework. Removing T3 launch, inventory, pairing, hooks and MCP wiring avoids competing ownership and reporting paths; native OMP model defaults replace hardcoded provider defaults.

Execution bindings use neutral identities. Recovery still requires proven ownership, uncertain delivery holds the attempt, and review, evidence, stop, usage and merge gates remain unchanged. A fresh operational database may be adopted only after explicit authorization, isolated verification, backup and graceful service shutdown; user applications, credentials and sessions are not removed.
