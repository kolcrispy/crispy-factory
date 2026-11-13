# PostgreSQL owner authentication without Neon

Accepted design direction, not an implementation-completion claim. Remove Neon authentication, realtime, hosting adapters, tooling, and configuration so the factory depends on ordinary PostgreSQL rather than a specific provider. Use owner-only email/password login and database sessions instead of HTTP Basic Auth, public signup, or parallel authentication systems.

## Access and recovery

Active owner accounts are the dashboard authorization authority, replacing the dashboard email allowlist. Trusted database operators create, reset, and disable accounts through the CLI, using hidden password input; there is no public registration, email recovery, or MFA in this scope. Passwords have at least eight characters and use Argon2id hashes. Resetting a password or disabling an account revokes every session; logout revokes the current session. Session idle expiry is 24 hours, with an absolute seven-day lifetime. Historical audit actors remain unchanged and are not automatically merged by email.

Browser traffic requires HTTPS or localhost access through an SSH tunnel; reverse-proxy internal HTTP is allowed. Use HttpOnly, SameSite cookies, Secure on HTTPS, origin/CSRF checks, and shared PostgreSQL login throttling by login identity and network address. Failed login messages must not disclose account existence. Trusted direct-database CLI access and gateway report/webhook authentication remain separate from browser sessions.

## Cutover and updates

Provision local owners before opening the new dashboard. Do not migrate Neon passwords or sessions, and fail closed if no local owner exists. Database migrations remain explicit. Replace dashboard push subscriptions with five-second polling while visible, stopping while hidden and refreshing after user actions; retain runner polling and startup reconciliation. This accepts bounded dashboard staleness instead of another push service. Existing external live acceptance remains deferred until designated test infrastructure is available.

## Migration safety

Keep recognition of the previous production database endpoint and its connection-string selectors in the migration guard. This is a fail-closed safety check against accidentally migrating the old production target, not an active provider integration. Cloud branch provisioning and its regression-harness fallback are removed.

## Verification

Disposable PostgreSQL regressions cover owner passwords, session isolation, logout, idle expiry, reset/disable revocation, shared login throttling, origin checks, and proxy access. A production dashboard started under Node.js without provider credentials; an actual Chromium browser signed in, opened the owner dashboard, fetched a protected jobs query (200), signed out, and observed the same query denied (401). Backend and dashboard builds passed. External Linear/T3/Modal acceptance remains deferred.
