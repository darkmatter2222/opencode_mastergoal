import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Engine } from "../dist/engine.js";
import { coding, adversarial, goalText } from "./corpus.mjs";
const rows = [];
for (const item of [...coding, ...adversarial]) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "mastergoal-bench-")),
  );
  const engine = new Engine(root, path.join(root, "state"));
  const started = performance.now();
  try {
    let contract = item.assertions
      ? {
          checks: [
            {
              id: "acceptance",
              type: "script",
              runtime: process.execPath,
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
      path.join(root, "goal.md"),
      goalText(item.title, item.objective ?? item.title, contract),
    );
    if (item.assertions) {
      await writeFile(
        path.join(root, "verify.mjs"),
        `import assert from 'node:assert/strict';import {solve} from './solution.mjs';\n${item.assertions}\n`,
      );
      await writeFile(
        path.join(root, "solution.mjs"),
        'export function solve(){throw Error("not implemented")}',
      );
    }
    if (item.script)
      await writeFile(path.join(root, "verify.mjs"), item.script);
    if (item.reviewScript)
      await writeFile(path.join(root, "review.mjs"), item.reviewScript);
    await engine.start("bench");
    let baseline = await engine.verify("bench");
    if (item.claim)
      await engine.mutate("bench", (s) => {
        s.todos = [{ content: item.claim, status: "completed" }];
      });
    if (item.solution)
      await writeFile(path.join(root, "solution.mjs"), item.solution);
    if (item.tamper)
      await writeFile(path.join(root, "verify.mjs"), item.tamper);
    const result = await engine.verify("bench");
    const expected = item.expected ?? "completed";
    const pass =
      result.status === expected &&
      (!item.solution || baseline.status === "active");
    rows.push({
      id: item.id,
      title: item.title,
      pass,
      baseline: baseline.status,
      actual: result.status,
      expected,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    });
  } catch (error) {
    rows.push({ id: item.id, pass: false, error: String(error) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const report = {
  kind: "Deterministic harness regression benchmark; scripted candidates, no live LLM",
  node: process.version,
  platform: process.platform,
  date: new Date().toISOString(),
  passed: rows.filter((x) => x.pass).length,
  total: rows.length,
  rows,
};
await writeFile(
  new URL("./latest.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
for (const row of rows)
  console.log(
    `${row.pass ? "PASS" : "FAIL"} ${row.id}: ${row.title ?? row.error} (${row.durationMs ?? 0} ms)`,
  );
console.log(
  `${report.passed}/${report.total} scenarios passed. This is not an LLM success-rate or competitor benchmark.`,
);
if (report.passed !== report.total) process.exitCode = 1;
