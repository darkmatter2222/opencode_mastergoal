import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stageRuntime } from "../dist/setup.js";
import { fixture } from "./helpers.mjs";

test("runtime staging strips build hooks without changing the cached distribution", async (t) => {
  const f = await fixture(t);
  const source = path.join(f.root, "cached package");
  const target = path.join(f.root, "staged package");
  await mkdir(source);
  for (const directory of ["dist", "docs", "examples"])
    await mkdir(path.join(source, directory));
  for (const file of [
    "server.js",
    "tui.js",
    "README.md",
    "LICENSE",
    "dist/cli.js",
  ])
    await writeFile(path.join(source, file), "compiled payload");
  const original = JSON.stringify({
    name: "test",
    version: "1.0.0",
    scripts: { prepare: "exit 99", prepack: "exit 99", postinstall: "exit 99" },
    devDependencies: { typescript: "5.9.3" },
    dependencies: { runtime: "1.0.0" },
    bin: { test: "dist/cli.js" },
  });
  await writeFile(path.join(source, "package.json"), original);
  await stageRuntime(source, target);
  const manifest = JSON.parse(
    await readFile(path.join(target, "package.json"), "utf8"),
  );
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.deepEqual(manifest.dependencies, { runtime: "1.0.0" });
  assert.deepEqual(manifest.bin, { test: "dist/cli.js" });
  assert.equal(
    await readFile(path.join(source, "package.json"), "utf8"),
    original,
  );
  assert.equal(
    await readFile(path.join(target, "dist/cli.js"), "utf8"),
    "compiled payload",
  );
});
