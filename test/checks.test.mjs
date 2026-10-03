import test from "node:test";
import assert from "node:assert/strict";
import { runCheck } from "../dist/checks.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

for (const cause of ["timeout", "overflow", "cancel"]) {
  test(`verifier process has exited before ${cause} resolves`, async (t) => {
    const f = await fixture(t);
    await f.write(
      "v.mjs",
      `import {writeFileSync} from "node:fs";
writeFileSync("pid.txt", String(process.pid));
${cause === "overflow" ? 'console.log("x".repeat(100000));' : ""}
setInterval(()=>{},1000);`,
    );
    const controller = new AbortController();
    const result = runCheck(
      f.root,
      {
        id: cause,
        type: "script",
        path: "v.mjs",
        runtime: process.execPath,
        timeoutMs: 1500,
      },
      controller.signal,
    );
    let pid;
    const deadline = Date.now() + 5000;
    while (!pid && Date.now() < deadline) {
      try {
        pid = Number(await readFile(path.join(f.root, "pid.txt"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (cause === "cancel") controller.abort();
    const outcome = await result;
    assert(pid, "Verifier must have started");
    assert.equal(outcome.passed, false);
    assert.equal(outcome.error, true);
    assert.match(
      outcome.detail,
      cause === "timeout"
        ? /timed out/
        : cause === "overflow"
          ? /exceeded/
          : /cancelled/,
    );
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  });
}
