import test from "node:test";
import assert from "node:assert/strict";
import { guardTool } from "../dist/guard.js";
import { fixture } from "./helpers.mjs";
test("writing documentation mentioning goal.md is allowed", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  await guardTool(f.engine, "s", "write", {
    filePath: "README.md",
    content: "Use goal.md as your contract.",
  });
});
test("structured patch cannot edit or delete the contract", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  for (const verb of ["Update", "Delete", "Add"])
    await assert.rejects(
      guardTool(f.engine, "s", "apply_patch", {
        patchText: `*** Begin Patch\n*** ${verb} File: goal.md\n*** End Patch`,
      }),
    );
});
test("patch moves cannot replace the contract", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  await assert.rejects(
    guardTool(f.engine, "s", "apply_patch", {
      patchText: "*** Update File: other.md\n*** Move to: goal.md",
    }),
  );
});
