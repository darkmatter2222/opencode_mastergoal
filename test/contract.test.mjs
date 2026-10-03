import test from "node:test";
import assert from "node:assert/strict";
import { symlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseGoal, lockGoal, within } from "../dist/contract.js";
import { contract, markdown, fixture } from "./helpers.mjs";
for (const [name, change] of [
  ["version", { version: 2 }],
  ["missing title", { title: "" }],
  ["unknown mode", { mode: "maybe" }],
  ["empty checks", { checks: [] }],
  ["unknown key", { surprise: true }],
  ["bad limits", { limits: { turns: -1 } }],
  ["unknown budget", { limits: { iterations: 3 } }],
  ["fast spin", { intervalMs: 1 }],
  [
    "duplicate checks",
    {
      checks: [
        { id: "x", type: "equals", actual: 1, expected: 1 },
        { id: "x", type: "equals", actual: 1, expected: 1 },
      ],
    },
  ],
  ["unknown check", { checks: [{ id: "x", type: "eval", code: "1" }] }],
  ["missing actual", { checks: [{ id: "x", type: "equals", expected: 1 }] }],
  [
    "bad digest",
    { checks: [{ id: "x", type: "file", path: "a", sha256: "fake" }] },
  ],
  [
    "bad arguments",
    {
      checks: [
        { id: "x", type: "script", path: "a", runtime: "node", args: "oops" },
      ],
    },
  ],
  [
    "zero timeout",
    {
      checks: [
        { id: "x", type: "script", path: "a", runtime: "node", timeoutMs: 0 },
      ],
    },
  ],
  [
    "excessive timeout",
    {
      checks: [
        {
          id: "x",
          type: "script",
          path: "a",
          runtime: "node",
          timeoutMs: 3600001,
        },
      ],
    },
  ],
  [
    "review equality",
    { review: { id: "r", type: "equals", actual: 1, expected: 1 } },
  ],
])
  test(`reject malformed contract: ${name}`, () =>
    assert.throws(() => parseGoal(markdown(contract(change)))));
test("reject absent and duplicate fences", () => {
  assert.throws(() => parseGoal("hello"));
  assert.throws(() => parseGoal(markdown(contract()) + markdown(contract())));
});
test("accept CRLF and surrounding prose", () =>
  assert.equal(
    parseGoal(markdown(contract()).replaceAll("\n", "\r\n")).title,
    "Fixture",
  ));
test("forever permits zero checks", () =>
  assert.equal(
    parseGoal(markdown(contract({ mode: "forever", checks: [] }))).checks
      .length,
    0,
  ));
test("reject oversized source", () =>
  assert.throws(() => parseGoal("x".repeat(256001))));
test("path traversal and absolute outside are rejected", async (t) => {
  const f = await fixture(t);
  await assert.rejects(within(f.root, "../"));
  await assert.rejects(within(f.root, "/etc/passwd"));
});
test("symlink escape is rejected", async (t) => {
  const f = await fixture(t);
  await symlink(
    path.dirname(f.root),
    path.join(f.root, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(within(f.root, "escape"));
});
test("lock pins scripts and dependencies", async (t) => {
  const f = await fixture(
    t,
    contract({
      checks: [
        {
          id: "s",
          type: "script",
          path: "verify.mjs",
          runtime: "node",
          pin: ["dep.mjs"],
        },
      ],
    }),
  );
  await f.write("verify.mjs", "");
  await f.write("dep.mjs", "");
  const g = await lockGoal(f.root);
  assert.equal(Object.keys(g.pins).length, 2);
});
