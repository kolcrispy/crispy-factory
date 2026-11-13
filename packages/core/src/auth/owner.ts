export type SessionUser = { email: string; emailVerified: boolean };

// Only trusted in-process entry points may mint an operator; transport input cannot forge membership.
const operators = new WeakSet<SessionUser>();

export function trustedOperator(actor: string): SessionUser {
  const email = actor.trim();
  if (!email) throw new Error("An operator identity is required.");
  const user = { email, emailVerified: true };
  operators.add(user);
  return user;
}

export function isAllowlisted(email: string | null | undefined, allowlist = process.env.FACTORY_OWNER_EMAILS) {
  if (!email || !allowlist) return false;
  const owners = allowlist.split(",").map((entry) => entry.trim().toLowerCase());
  return owners.includes(email.trim().toLowerCase());
}

// Sign-up can be briefly on to create the owner, so an allowlisted address counts only once its inbox proved it.
export function isOwner(user: SessionUser | null | undefined, allowlist = process.env.FACTORY_OWNER_EMAILS) {
  if (user && operators.has(user)) return true;
  return user?.emailVerified === true && isAllowlisted(user.email, allowlist);
}
