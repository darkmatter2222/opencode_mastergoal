import test from "node:test";
import assert from "node:assert/strict";
import { Coordinator } from "../dist/coordinator.js";
import { fixture, contract } from "./helpers.mjs";
function setup(f, options = {}) {
  let prompts = 0,
    reports = [];
  const c = new Coordinator(f.engine, {
    busy: async () => false,
    prompt: async () => {
      prompts++;
    },
    report: async (_, text) => {
      reports.push(text);
    },
    ...options,
  });
  return {
    c,
    get prompts() {
      return prompts;
    },
    reports,
  };
}
test("duplicate idle ticks only admit one prompt", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  const h = setup(f);
  await Promise.all(Array.from({ length: 8 }, () => h.c.tick("s")));
  await h.c.tick("s");
  assert.equal(h.prompts, 1);
  await h.c.dispose();
});
test("stale idle cannot release admission; real turn completion does", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  const h = setup(f);
  await h.c.tick("s");
  h.c.settled("s");
  await h.c.tick("s");
  assert.equal(h.prompts, 1);
  h.c.started("s");
  h.c.settled("s");
  await h.c.tick("s");
  assert.equal(h.prompts, 2);
  await h.c.dispose();
});
test("passing goal never dispatches model turn", async (t) => {
  const f = await fixture(
    t,
    contract({ checks: [{ id: "x", type: "equals", actual: 1, expected: 1 }] }),
  );
  await f.engine.start("s");
  const h = setup(f);
  await h.c.tick("s");
  assert.equal(h.prompts, 0);
  assert.equal(h.reports.length, 1);
  await h.c.dispose();
});
test("host busy defers verification and prompt", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  const h = setup(f, { busy: async () => true });
  await h.c.tick("s");
  assert.equal(h.prompts, 0);
  assert.equal((await f.engine.store("s").read()).iterations, 0);
  await h.c.dispose();
});
test("delivery error becomes blocked, never completed", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  const h = setup(f, {
    prompt: async () => {
      throw new Error("offline");
    },
  });
  await h.c.tick("s");
  assert.equal((await f.engine.store("s").read()).status, "blocked");
  await h.c.dispose();
});
test("stop before scheduled tick prevents continuation", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  const h = setup(f);
  h.c.schedule("s", 30);
  h.c.cancel("s");
  await f.engine.control("s", "stop");
  await h.c.tick("s");
  assert.equal(h.prompts, 0);
  await h.c.dispose();
});
test("dispose prevents all further dispatch", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  const h = setup(f);
  await h.c.dispose();
  await h.c.tick("s");
  assert.equal(h.prompts, 0);
});
