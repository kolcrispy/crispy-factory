# Marshal Factory

Marshal Factory turns source issues into agent-built pull requests under human supervision.

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
