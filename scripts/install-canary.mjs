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
    { maxBuffer: 8 * 1024 * 1024, ...options },
  );
try {
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
  for (const host of [1, 2]) {
    const scope =
      host === 1 ? ["--local", path.join(root, "project")] : ["--global"];
    const target =
      host === 1 ? path.join(root, "project") : env.OPENCODE_CONFIG_DIR;
    await npm(
      [
        "exec",
        "--yes",
        `--package=${tar}`,
        "--",
        "mastergoal",
        "install",
        "--host",
        String(host),
        ...scope,
      ],
      { env },
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
      [
        path.join(runtime, "dist/cli.js"),
        "uninstall",
        "--host",
        String(host),
        ...scope,
      ],
      { env },
    );
    const removed = JSON.parse(
      await readFile(path.join(target, "opencode.json"), "utf8"),
    );
    assert.equal((removed.plugin || removed.plugins).length, 0);
  }
  console.log(
    "Packaged npx install, durable CLI and uninstall passed: local v1 + global v2.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
