import { mkdir, writeFile } from "node:fs/promises";
import { coding, adversarial, goalText } from "../benchmarks/corpus.mjs";
for (const item of [...coding, ...adversarial]) {
  const dir = new URL(`../examples/${item.id}/`, import.meta.url);
  await mkdir(dir, { recursive: true });
  const c = item.assertions
    ? {
        checks: [
          {
            id: "acceptance",
            type: "script",
            runtime: "node",
            path: "verify.mjs",
          },
        ],
      }
    : {
        mode: item.mode ?? "verified",
        checks: item.checks,
        ...(item.review ? { review: item.review } : {}),
      };
  await writeFile(
    new URL("goal.md", dir),
    goalText(item.title, item.objective ?? item.title, c),
  );
  if (item.assertions) {
    await writeFile(
      new URL("verify.mjs", dir),
      `import assert from 'node:assert/strict';\nimport {solve} from './solution.mjs';\n${item.assertions}\n`,
    );
    await writeFile(
      new URL("solution.mjs", dir),
      'export function solve(){throw new Error("Implement this function")}\n',
    );
  }
  if (item.script)
    await writeFile(new URL("verify.mjs", dir), item.script + "\n");
  if (item.reviewScript)
    await writeFile(new URL("review.mjs", dir), item.reviewScript + "\n");
}
