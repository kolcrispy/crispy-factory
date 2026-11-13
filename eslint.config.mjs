import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const sourceMessage = "Use sourceFor(job.source), allSources(), or panelSource() from the core source module.";
const paths = [
  { regex: "^(@factory/integrations/linear|(\\.\\.?/)+linear)(\\.[jt]s)?$", message: "Only the Linear adapter imports the Linear client." },
  { regex: "^@factory/integrations/sources/", message: sourceMessage },
];
const literal = regex => `Literal[value=/${regex.replaceAll("/", "\\/")}/]`;
const syntax = paths.flatMap(({ regex, message }) => [
  { selector: `ImportExpression > ${literal(regex)}.source`, message },
  { selector: `CallExpression[callee.name='require'] > ${literal(regex)}.arguments`, message },
]);
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(["**/.next/**", "**/dist/**", "out/**", "build/**", "**/next-env.d.ts"]),
  { rules: {
    "no-restricted-imports": ["error", { patterns: paths }],
    "no-restricted-syntax": ["error", ...syntax,
      { selector: "CallExpression[callee.name='sourceFor'] > Literal.arguments", message: sourceMessage },
      { selector: "CallExpression[callee.name='sourceFor'] > TemplateLiteral.arguments", message: sourceMessage },
    ],
    "no-restricted-properties": ["error", { property: "mergePull", message: "Record an approve_merge intent; only the runner merge module merges PRs." }],
  } },
  { files: ["packages/core/src/sources/**/*.ts", "packages/integrations/src/sources/**/*.ts", "scripts/**/*.ts"], rules: { "no-restricted-imports": "off", "no-restricted-syntax": "off" } },
  { files: ["apps/runner/src/merge-service.ts", "scripts/github-regressions.ts"], rules: { "no-restricted-properties": "off" } },
  { files: ["packages/**/*.ts"], rules: { "no-restricted-imports": ["error", { patterns: [...paths, { regex: "^(next|react)(/|$)", message: "Shared backend modules must not depend on the dashboard framework." }] }] } },
  { files: ["packages/**/*.ts"], rules: { "no-restricted-syntax": ["error", ...syntax,
    { selector: "ImportExpression > Literal[value=/^(next|react)(\\/|$)/].source", message: "Shared modules must not import dashboard frameworks." },
    { selector: "CallExpression[callee.name='sourceFor'] > Literal.arguments", message: sourceMessage },
    { selector: "CallExpression[callee.name='sourceFor'] > TemplateLiteral.arguments", message: sourceMessage },
  ] } },
  { files: ["packages/core/src/sources/**/*.ts", "packages/integrations/src/sources/**/*.ts"], rules: { "no-restricted-imports": "off" } },
  { files: ["scripts/**/*.ts"], rules: { "no-restricted-imports": ["error", { patterns: [paths[0]] }], "no-restricted-syntax": ["error", ...syntax.slice(0, 2)] } },
  { files: ["scripts/linear-regressions.ts"], rules: { "no-restricted-imports": "off", "no-restricted-syntax": "off" } },
]);
