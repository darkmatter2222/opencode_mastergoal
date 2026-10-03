// Exercises the actual npm pack/exec path with isolated local and global config.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "mastergoal-package-"));
const repo = path.resolve(import.meta.dirname, "..");
const npmScript =
  process.env.npm_execpath ||
  (process.platform === "win32"
    ? path.join(
        path.dirname(process.execPath),
        "node_modules/npm/bin/npm-cli.js",
      )
    : undefined);
const npm = (args, options = {}) =>
  exec(
    npmScript ? process.execPath : "npm",
    npmScript ? [npmScript, ...args] : args,
    { maxBuffer: 8 * 1024 * 1024, timeout: 180000, ...options },
  );
try {
  console.log("Packing source distribution...");
  const packed = await npm(
    ["pack", "--ignore-scripts", "--json", "--pack-destination", root],
    { cwd: repo },
  );
  // npm 10 may print prepare output before the JSON result.
  const packedJson = packed.stdout.slice(packed.stdout.indexOf("["));
  const tar = path.join(root, JSON.parse(packedJson)[0].filename);
  const env = {
    ...process.env,
    OPENCODE_CONFIG_DIR: path.join(root, "global"),
  };
  for (const scopeName of ["local", "global"]) {
    const scope =
      scopeName === "local"
        ? ["--local", path.join(root, "project")]
        : ["--global"];
    const target =
      scopeName === "local"
        ? path.join(root, "project")
        : env.OPENCODE_CONFIG_DIR;
    console.log(`Installing ${scopeName} packaged runtime...`);
    await npm(
      [
        "exec",
        "--yes",
        `--package=${tar}`,
        "--",
        "mastergoal",
        "install",
        ...scope,
      ],
      { env },
    );
    console.log(
      `Installed ${scopeName}; checking registration and uninstall...`,
    );
    const config = JSON.parse(
      await readFile(path.join(target, "opencode.json"), "utf8"),
    );
    assert.match((config.plugin || config.plugins)[0], /\.mastergoal-runtime/);
    assert.doesNotMatch((config.plugin || config.plugins)[0], /_npx/);
    const runtime = path.join(
      target,
      ".mastergoal-runtime/node_modules/@darkmatter2222/opencode-mastergoal",
    );
    const manifest = JSON.parse(
      await readFile(path.join(runtime, "package.json"), "utf8"),
    );
    assert.equal(manifest.exports["./v1"], undefined);
    assert.equal(manifest.exports["./tui-v1"], undefined);
    assert.equal(manifest.dependencies["@opencode-ai/plugin"], undefined);
    await assert.rejects(readFile(path.join(runtime, "dist/v1.js")), {
      code: "ENOENT",
    });
    assert.equal(
      manifest.scripts,
      undefined,
      "Installed runtime cannot run prepare or prepack",
    );
    await assert.rejects(readFile(path.join(runtime, "tsconfig.json")), {
      code: "ENOENT",
    });
    const help = await exec(process.execPath, [
      path.join(runtime, "dist/cli.js"),
      "help",
    ]);
    assert.match(help.stdout, /construct/);
    await exec(
      process.execPath,
      [path.join(runtime, "dist/cli.js"), "uninstall", ...scope],
      { env },
    );
    console.log(`Uninstalled ${scopeName}.`);
    const removed = JSON.parse(
      await readFile(path.join(target, "opencode.json"), "utf8"),
    );
    assert.equal((removed.plugin || removed.plugins).length, 0);
  }
  console.log(
    "Packaged npx install, durable CLI and uninstall passed: local + global, OpenCode 2.x only.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
