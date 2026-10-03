import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Engine } from "../dist/engine.js";
export const contract = (overrides = {}) => ({
  version: 1,
  title: "Fixture",
  mode: "verified",
  checks: [{ id: "math", type: "equals", actual: 2, expected: 3 }],
  ...overrides,
});
export const markdown = (c) =>
  `# Objective\nDo useful work; do not weaken checks.\n\n\`\`\`mastergoal\n${JSON.stringify(c, null, 2)}\n\`\`\`\n`;
export async function fixture(t, c = contract()) {
  const temp = await mkdtemp(path.join(tmpdir(), "mastergoal-test-"));
  const root = await realpath(temp);
  const state = path.join(root, "state");
  await writeFile(path.join(root, "goal.md"), markdown(c));
  if (t) t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    state,
    engine: new Engine(root, state),
    write: (file, text) => writeFile(path.join(root, file), text),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
