const SECRET_PATTERNS = [
  /xox[abposr]-[A-Za-z0-9-]{10,}/g,
  /xapp-[A-Za-z0-9-]{10,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /lin_(?:api|oauth)_[A-Za-z0-9]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

export function redact(text: string, secrets: readonly string[] = []) {
  let out = text;
  for (const secret of secrets) if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL)/i;
export const secretValues = (env: Record<string, string | undefined>) => Object.entries(env).flatMap(([name, value]) => value && SECRET_NAME.test(name) ? [value] : []);
