import test from "node:test";
import assert from "node:assert/strict";
import { runCheck } from "../dist/checks.js";
import { digest } from "../dist/contract.js";
import { fixture } from "./helpers.mjs";
for (const [name, source, passed] of [
  ["success", "process.exit(0)", true],
  ["failure", "process.exit(1)", false],
  ["crash", 'throw new Error("broken")', false],
  ["timeout", "setInterval(()=>{},1000)", false],
  ["overflow", 'console.log("x".repeat(100000))', false],
])
  test(`script ${name}`, async (t) => {
    const f = await fixture(t);
    await f.write("v.mjs", source);
    const r = await runCheck(f.root, {
      id: name,
      type: "script",
      path: "v.mjs",
      runtime: process.execPath,
      timeoutMs: 200,
    });
    assert.equal(r.passed, passed);
  });
test("missing executable fails closed", async (t) => {
  const f = await fixture(t);
  await f.write("v.mjs", "");
  assert.equal(
    (
      await runCheck(f.root, {
        id: "x",
        type: "script",
        path: "v.mjs",
        runtime: "not-a-real-runtime-abc",
      })
    ).passed,
    false,
  );
});
test("no shell interpolation in arguments", async (t) => {
  const f = await fixture(t);
  await f.write(
    "v.mjs",
    'if(process.argv[2]!=="$(touch hacked)")process.exit(1)',
  );
  assert.equal(
    (
      await runCheck(f.root, {
        id: "x",
        type: "script",
        path: "v.mjs",
        runtime: process.execPath,
        args: ["$(touch hacked)"],
      })
    ).passed,
    true,
  );
});
for (const [name, check, passed] of [
  ["exists", { path: "a" }, true],
  ["contains", { path: "a", contains: "hello" }, true],
  ["mismatch", { path: "a", contains: "missing" }, false],
  ["digest", { path: "a", sha256: digest("hello") }, true],
  ["bad digest", { path: "a", sha256: "0".repeat(64) }, false],
  ["missing", { path: "missing" }, false],
  ["directory", { path: "." }, false],
])
  test(`file ${name}`, async (t) => {
    const f = await fixture(t);
    await f.write("a", "hello");
    assert.equal(
      (await runCheck(f.root, { id: "f", type: "file", ...check })).passed,
      passed,
    );
  });
for (const [actual, expected, passed] of [
  [2, 3, false],
  [2, 2, true],
  ["2", 2, false],
  [{ a: 1, b: 2 }, { b: 2, a: 1 }, true],
  [[1, 2], [2, 1], false],
  [null, null, true],
])
  test(`strict equality ${JSON.stringify(actual)} / ${JSON.stringify(expected)}`, async (t) => {
    const f = await fixture(t);
    assert.equal(
      (await runCheck(f.root, { id: "e", type: "equals", actual, expected }))
        .passed,
      passed,
    );
  });
