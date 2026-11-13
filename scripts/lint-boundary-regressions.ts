import "./test-guard";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ESLint } from "eslint";

const root = join(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: root });
const messages = async (file: string, code: string) =>
  (await eslint.lintText(code, { filePath: join(root, file) })).flatMap(r => r.messages.map(m => m.ruleId ?? m.message));
const cases: { file: string; code: string; want: string[] }[] = [
  { file: "apps/runner/src/x.ts", code: 'import { linear } from "@factory/integrations/sources/linear";\nvoid linear;\n', want: ["no-restricted-imports"] },
  { file: "apps/dashboard/app/x.ts", code: 'export const m = import("@factory/integrations/sources/linear");\n', want: ["no-restricted-syntax"] },
  { file: "packages/core/src/x.ts", code: 'import { linearClient } from "@factory/integrations/linear";\nvoid linearClient;\n', want: ["no-restricted-imports"] },
  { file: "scripts/x-regressions.ts", code: 'import { linearClient } from "@factory/integrations/linear";\nvoid linearClient;\n', want: ["no-restricted-imports"] },
  { file: "apps/runner/src/x.ts", code: 'import { sourceFor } from "@factory/core/sources/index";\nexport const s = sourceFor("linear");\n', want: ["no-restricted-syntax"] },
  { file: "packages/core/src/x.ts", code: 'import { after } from "next/server";\nvoid after;\n', want: ["no-restricted-imports"] },
  { file: "packages/integrations/src/x.ts", code: 'import { useState } from "react";\nvoid useState;\n', want: ["no-restricted-imports"] },
  { file: "packages/core/src/sources/index.ts", code: 'import { after } from "next/server";\nvoid after;\n', want: ["no-restricted-imports"] },
  { file: "packages/integrations/src/sources/linear.ts", code: 'import { useState } from "react";\nvoid useState;\n', want: ["no-restricted-imports"] },
  { file: "apps/runner/src/x.ts", code: 'import { sourceFor } from "@factory/core/sources/index";\nimport type { Job } from "@factory/core/sources/types";\nexport const s = (job: Job) => sourceFor(job.source);\n', want: [] },
  { file: "packages/core/src/sources/index.ts", code: 'import { linear } from "@factory/integrations/sources/linear";\nexport const s = linear;\n', want: [] },
  { file: "packages/integrations/src/sources/linear.ts", code: 'import { linearClient } from "../linear";\nvoid linearClient;\n', want: [] },
  { file: "scripts/x-regressions.ts", code: 'import { createLinearAdapter } from "@factory/integrations/sources/linear";\nvoid createLinearAdapter;\n', want: [] },
];
for (const c of cases) assert.deepEqual(await messages(c.file, c.code), c.want, `${c.file}: ${c.code.split("\n")[0]}`);
console.log("lint boundary regressions passed");
