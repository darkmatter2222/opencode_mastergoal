import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { command, initGoal } from "../dist/commands.js";
import { install } from "../dist/install.js";
import { parseGoal } from "../dist/contract.js";
import { fixture } from "./helpers.mjs";
test("init refuses to overwrite existing goal", async (t) => {
  const f = await fixture(t);
  await assert.rejects(initGoal(f.root));
});
test("init creates usable goal and deliberately failing verifier", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.root, "goal.md"));
  await initGoal(f.root);
  parseGoal(await readFile(path.join(f.root, "goal.md"), "utf8"));
  await f.engine.start("s");
  assert.equal((await f.engine.verify("s")).status, "active");
});
test("unknown command does not mutate lifecycle", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  await assert.rejects(command(f.engine, "s", "complete"));
  assert.equal((await f.engine.store("s").read()).status, "active");
});
test("command aliases and status", async (t) => {
  const f = await fixture(t);
  assert.equal((await command(f.engine, "s", "start")).kick, true);
  assert.match((await command(f.engine, "s", "status")).text, /ACTIVE/);
  await command(f.engine, "s", "end");
  assert.match((await command(f.engine, "s", "status")).text, /STOPPED/);
});
test("2.x installer preserves JSONC, unrelated plugins and is idempotent", async (t) => {
  const f = await fixture(t);
  await f.write(
    "opencode.jsonc",
    '{\n // keep me\n "' +
      "plugins" +
      '": ["other-plugin"],\n "model":"mine",\n}\n',
  );
  await install(f.root);
  await install(f.root);
  const text = await readFile(path.join(f.root, "opencode.jsonc"), "utf8");
  assert.match(text, /keep me/);
  assert.match(text, /other-plugin/);
  assert.equal((text.match(/file:\/\//g) ?? []).length, 1);
  await install(f.root, true);
  assert.doesNotMatch(
    await readFile(path.join(f.root, "opencode.jsonc"), "utf8"),
    /file:\/\//,
  );
});
test("invalid config aborts install before writes", async (t) => {
  const f = await fixture(t);
  await f.write("opencode.json", "{broken");
  await assert.rejects(install(f.root));
  await assert.rejects(readFile(path.join(f.root, "tui.json")));
});

test("construct accepts natural prose without a contract and preserves files", async (t) => {
  const f = await fixture(t);
  const prose =
    "# Goal\nBuild add(a,b) with correct negative-number arithmetic.\n";
  await f.write("goal.md", prose);
  const result = await command(f.engine, "s", "construct");
  assert.equal(result.kick, false);
  assert.match(result.construction, /negative-number/);
  assert.match(result.construction, /known incorrect outputs fail/);
  assert.equal(await readFile(path.join(f.root, "goal.md"), "utf8"), prose);
  const { constructionContext } = await import("../dist/construct.js");
  assert.equal(await constructionContext(f.engine, "s"), result.construction);
  assert.equal(await f.engine.store("s").read(), undefined);
});
for (const status of ["active", "paused", "blocked"]) {
  test(`construct refuses ${status} locked contracts`, async (t) => {
    const f = await fixture(t);
    await f.engine.start("s");
    await f.engine.mutate("s", (s) => {
      s.status = status;
    });
    await assert.rejects(command(f.engine, "s", "construct"), /Stop/);
  });
}
test("construct rejects template, path escape, and missing input", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.root, "goal.md"));
  await initGoal(f.root);
  await assert.rejects(
    command(f.engine, "s", "construct"),
    /Write your objective/,
  );
  await assert.rejects(command(f.engine, "s", "construct ../outside.md"));
  await assert.rejects(command(f.engine, "s", "construct missing.md"));
});
test("successful start clears construction context", async (t) => {
  const f = await fixture(t);
  await command(f.engine, "s", "construct");
  await command(f.engine, "s", "start");
  const { constructionContext } = await import("../dist/construct.js");
  assert.equal(await constructionContext(f.engine, "s"), "");
});
test("global config respects OpenCode and XDG overrides", async () => {
  const { globalConfig } = await import("../dist/setup.js");
  assert.equal(
    globalConfig({ OPENCODE_CONFIG_DIR: "/custom", XDG_CONFIG_HOME: "/xdg" }),
    "/custom",
  );
  assert.equal(
    globalConfig({ XDG_CONFIG_HOME: "/xdg" }),
    path.join("/xdg", "opencode"),
  );
});

test("CLI entry works through the symlink used by npx", async (t) => {
  const f = await fixture(t);
  const { symlink } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const target = path.resolve(import.meta.dirname, "../dist/cli.js");
  const link = path.join(f.root, "mastergoal.mjs");
  try {
    await symlink(target, link, "file");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.skip("Symlink privilege unavailable");
      return;
    }
    throw error;
  }
  const result = await promisify(execFile)(process.execPath, [link, "help"]);
  assert.match(result.stdout, /construct/);
});

test("2.x registration discovers both entrypoints without creating terminal config", async (t) => {
  const f = await fixture(t);
  await install(f.root);
  const config = JSON.parse(
    await readFile(path.join(f.root, "opencode.json"), "utf8"),
  );
  assert.equal(config.plugins.length, 1);
  assert.equal(config.plugin, undefined);
  for (const name of ["tui.json", "cli.json"])
    await assert.rejects(readFile(path.join(f.root, name)), { code: "ENOENT" });
});
test("upgrade removes only owned legacy entries and preserves other plugin registrations", async (t) => {
  const f = await fixture(t);
  const { pathToFileURL } = await import("node:url");
  const runtime = path.join(
    f.root,
    ".mastergoal-runtime/node_modules/@darkmatter2222/opencode-mastergoal",
  );
  const spec = pathToFileURL(runtime).href;
  await f.write(
    "opencode.json",
    JSON.stringify({
      plugin: ["other-server", spec + "/dist/v1.js"],
      plugins: [spec],
    }),
  );
  await f.write(
    "tui.json",
    JSON.stringify({
      plugin: ["other-tui", spec + "/dist/tui-v1.js"],
      plugins: [spec],
      theme: "dark",
    }),
  );
  await f.write("cli.json", JSON.stringify({ plugins: ["other-cli", spec] }));
  await install(f.root, false, runtime);
  const server = JSON.parse(
    await readFile(path.join(f.root, "opencode.json"), "utf8"),
  );
  assert.equal(server.plugin, undefined);
  assert.deepEqual(server.plugins, ["other-server", spec]);
  const tui = JSON.parse(await readFile(path.join(f.root, "tui.json"), "utf8"));
  assert.deepEqual(tui.plugin, ["other-tui"]);
  assert.deepEqual(tui.plugins, []);
  assert.equal(tui.theme, "dark");
  const cli = JSON.parse(await readFile(path.join(f.root, "cli.json"), "utf8"));
  assert.deepEqual(cli.plugins, ["other-cli"]);
});
test("CLI rejects the retired host before changing configuration", async () => {
  const { main } = await import("../dist/cli.js");
  await assert.rejects(
    main(["install", "--host", "1", "--global"]),
    /requires OpenCode 2/,
  );
});
