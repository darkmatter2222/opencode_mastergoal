import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { command } from "../dist/commands.js";
import { Coordinator } from "../dist/coordinator.js";
import { Engine } from "../dist/engine.js";
import { fixture } from "./helpers.mjs";

test("plain Markdown repeats verbatim across turns, recovery, pause and stop", async (t) => {
  const f = await fixture(t);
  const prompt =
    "# Ongoing work\nInspect the project and improve one issue each pass.\n";
  await f.write("my prompt.md", prompt);
  assert.equal(
    (await command(f.engine, "s", "forever my prompt.md")).kick,
    true,
  );
  const prompts = [];
  const host = {
    busy: async () => false,
    prompt: async (_, text) => prompts.push(text),
    report: async () => {},
  };
  const c = new Coordinator(f.engine, host);
  t.after(() => c.dispose());
  for (let i = 0; i < 3; i++) {
    await c.tick("s");
    await c.tick("s"); // No overlapping repeat before the turn settles.
    assert.equal(prompts.length, i + 1);
    c.started("s");
    c.settled("s");
    await f.engine.mutate("s", (s) => {
      s.todos = [{ content: "DONE", status: "completed" }];
    });
  }
  assert.deepEqual(prompts, [prompt, prompt, prompt]);
  c.cancel("s");
  await command(f.engine, "s", "pause");
  await c.tick("s");
  assert.equal(prompts.length, 3);
  // The saved prompt, not a mutable source file, is the ongoing task.
  await rm(path.join(f.root, "my prompt.md"));
  const recovered = new Engine(f.root, f.state);
  await recovered.recover("s");
  await command(recovered, "s", "resume");
  const next = new Coordinator(recovered, host);
  t.after(() => next.dispose());
  await next.tick("s");
  assert.equal(prompts[3], prompt);
  assert.equal((await recovered.store("s").read()).status, "active");
  assert.doesNotMatch(await recovered.context("s"), /Only the host verifier/);
  next.cancel("s");
  await command(recovered, "s", "end");
  await next.tick("s");
  assert.equal(prompts.length, 4);
  assert.equal((await recovered.store("s").read()).status, "stopped");
});

test("forever ignores malformed contract fences and missing verifier references", async (t) => {
  const f = await fixture(t);
  for (const prompt of [
    "Do work\n```mastergoal\nnot json\n```\n",
    'Do work\n```mastergoal\n{"mode":"verified","checks":[{"type":"script","path":"missing.mjs"}],"limits":{"turns":1}}\n```\n',
  ]) {
    await f.write("goal.md", prompt);
    const s = await f.engine.start("s", "goal.md", true);
    await f.engine.account("s", "done", { output: 100 }, s.createdAt);
    assert.equal((await f.engine.verify("s")).status, "active");
    assert.deepEqual(s.goal.pins, {});
    assert.deepEqual(s.goal.contract.checks, []);
    assert.equal(s.goal.contract.limits, undefined);
    await f.engine.control("s", "stop");
  }
});

for (const [name, content] of [
  ["empty", " \n"],
  ["oversized", "x".repeat(256001)],
]) {
  test(`forever rejects ${name} input without creating state`, async (t) => {
    const f = await fixture(t);
    await f.write("goal.md", content);
    await assert.rejects(command(f.engine, "s", "forever"));
    assert.equal(await f.engine.store("s").read(), undefined);
  });
}

test("forever rejects missing files and project escapes; normal start still needs a contract", async (t) => {
  const f = await fixture(t);
  await f.write("goal.md", "Keep improving this project.");
  await assert.rejects(command(f.engine, "s", "forever missing.md"));
  await assert.rejects(command(f.engine, "s", "forever ../goal.md"));
  await assert.rejects(
    command(f.engine, "s", "start"),
    /mastergoal JSON block/,
  );
  assert.equal(await f.engine.store("s").read(), undefined);
});
