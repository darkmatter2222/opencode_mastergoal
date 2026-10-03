import test from "node:test";
import assert from "node:assert/strict";
import v1 from "../dist/v1.js";
import v2 from "../dist/server.js";
import { fixture, contract } from "./helpers.mjs";
import { Engine } from "../dist/engine.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
test("V1 registers command, injects compaction context and exposes read-only status", async (t) => {
  const f = await fixture(t);
  const prior = process.env.MASTERGOAL_STATE_DIR;
  process.env.MASTERGOAL_STATE_DIR = f.state;
  t.after(() => {
    if (prior === undefined) delete process.env.MASTERGOAL_STATE_DIR;
    else process.env.MASTERGOAL_STATE_DIR = prior;
  });
  const hooks = await v1({
    directory: f.root,
    client: {
      tui: { showToast: async () => ({}) },
      session: {
        status: async () => ({ data: {} }),
        promptAsync: async () => ({}),
      },
    },
  });
  t.after(() => hooks.dispose());
  const config = {};
  await hooks.config(config);
  assert(config.command.goal);
  await assert.rejects(hooks.config(config));
  const out = { parts: [] };
  await hooks["command.execute.before"](
    { command: "goal", sessionID: "s", arguments: "construct" },
    out,
  );
  assert.match(out.parts[0].text, /MASTER GOAL CONSTRUCTION/);
  const draft = { context: [] };
  await hooks["experimental.session.compacting"]({ sessionID: "s" }, draft);
  assert.match(draft.context[0], /MASTER GOAL CONSTRUCTION/);

  await hooks["command.execute.before"](
    { command: "goal", sessionID: "s", arguments: "start" },
    out,
  );
  assert(out.parts[0].text.includes("Locked contract"));
  const compact = { context: [] };
  await hooks["experimental.session.compacting"]({ sessionID: "s" }, compact);
  assert(compact.context[0].includes("goal"));
  assert.deepEqual(Object.keys(hooks.tool), ["mastergoal_status"]);
  await assert.rejects(
    hooks["tool.execute.before"](
      { sessionID: "s", tool: "write" },
      { args: { filePath: "goal.md" } },
    ),
  );
  await hooks.event({
    event: { type: "session.error", properties: { sessionID: "s" } },
  });
  assert.equal((await f.engine.store("s").read()).status, "blocked");
});
test("V2 native command, context, RPC, event telemetry and disposal", async (t) => {
  const f = await fixture(t);
  const prior = process.env.MASTERGOAL_STATE_DIR;
  process.env.MASTERGOAL_STATE_DIR = f.state;
  t.after(() => {
    if (prior === undefined) delete process.env.MASTERGOAL_STATE_DIR;
    else process.env.MASTERGOAL_STATE_DIR = prior;
  });
  let cmd, rpc, release;
  const hooks = {},
    tools = [],
    queue = [];
  let wake;
  const fakeEvents = {
    async *[Symbol.asyncIterator]() {
      while (!release) {
        if (!queue.length) await new Promise((r) => (wake = r));
        while (queue.length) yield queue.shift();
      }
    },
  };
  const reg = () => ({ dispose: async () => {} });
  const synthetic = [];
  const constructionPrompts = [];
  const ctx = {
    location: { directory: f.root },
    session: {
      get: async () => ({ location: { directory: f.root } }),
      prompt: async (input) => constructionPrompts.push(input),
      synthetic: async (x) => synthetic.push(x),
      hook: async (n, fn) => {
        hooks[n] = fn;
        return reg();
      },
    },
    command: {
      transform: async (fn) => {
        fn({ add: (c) => (cmd = c) });
        return reg();
      },
    },
    rpc: {
      register: async (_, h) => {
        rpc = h;
        return reg();
      },
    },
    tool: {
      transform: async (fn) => {
        fn({ add: (x) => tools.push(x) });
        return reg();
      },
      hook: async () => reg(),
    },
    event: {
      subscribe: ({ signal }) => {
        signal.addEventListener("abort", () => {
          release = true;
          wake?.();
        });
        return fakeEvents;
      },
    },
  };
  const dispose = await v2.setup(ctx);
  t.after(dispose);
  await cmd.execute({ sessionID: "s", prompt: { text: "construct" } });
  assert.match(constructionPrompts[0].text, /MASTER GOAL CONSTRUCTION/);
  assert.equal(constructionPrompts[0].resume, true);
  const draft = { sessionID: "s", system: [] };
  await hooks.compaction(draft);
  assert.match(draft.system[0].text, /MASTER GOAL CONSTRUCTION/);

  await cmd.execute({
    sessionID: "s",
    prompt: { text: "start" },
    delivery: "queue",
  });
  assert.equal(synthetic[0].resume, false);
  const context = { sessionID: "s", system: [] };
  await hooks.context(context);
  assert(context.system[0].text.includes("MASTER GOAL"));
  assert.match((await rpc.read({ sessionID: "s" })).text, /ACTIVE/);
  assert.deepEqual(
    tools.map((x) => x.name),
    ["mastergoal_status"],
  );
  const created = Date.now();
  queue.push(
    {
      type: "session.step.started",
      id: "a",
      created,
      data: { sessionID: "s" },
    },
    {
      type: "session.step.ended",
      id: "b",
      created: created + 100,
      data: {
        sessionID: "s",
        tokens: {
          input: 10,
          output: 5,
          reasoning: 2,
          cache: { read: 3, write: 1 },
        },
        cost: 0.1,
      },
    },
  );
  wake?.();
  await wait(30);
  const state = await f.engine.store("s").read();
  assert.equal(state.usage.output, 5);
  assert.equal(state.usage.durationMs, 100);
  await cmd.execute({ sessionID: "s", prompt: { text: "stop" } });
  assert.equal((await f.engine.store("s").read()).status, "stopped");
});
test("V2 status command cannot cancel a pending continuation", async (t) => {
  const f = await fixture(t);
  const prior = process.env.MASTERGOAL_STATE_DIR;
  process.env.MASTERGOAL_STATE_DIR = f.state;
  t.after(() => {
    if (prior === undefined) delete process.env.MASTERGOAL_STATE_DIR;
    else process.env.MASTERGOAL_STATE_DIR = prior;
  });
  let cmd,
    done,
    wake,
    prompts = 0;
  const reg = () => ({ dispose: async () => {} });
  const ctx = {
    location: { directory: f.root },
    session: {
      get: async () => ({ location: { directory: f.root } }),
      prompt: async () => {
        prompts++;
      },
      synthetic: async () => {},
      hook: async () => reg(),
    },
    command: {
      transform: async (fn) => {
        fn({ add: (c) => (cmd = c) });
        return reg();
      },
    },
    rpc: { register: async () => reg() },
    tool: {
      transform: async (fn) => {
        fn({ add: () => {} });
        return reg();
      },
      hook: async () => reg(),
    },
    event: {
      subscribe: ({ signal }) => {
        signal.addEventListener("abort", () => {
          done = true;
          wake?.();
        });
        return {
          async *[Symbol.asyncIterator]() {
            while (!done) await new Promise((r) => (wake = r));
          },
        };
      },
    },
  };
  const dispose = await v2.setup(ctx);
  t.after(dispose);
  await cmd.execute({ sessionID: "s", prompt: { text: "start" } });
  await cmd.execute({ sessionID: "s", prompt: { text: "status" } });
  await wait(400);
  assert.equal(prompts, 1);
});
test("V1 restart pauses stale verification and can resume with fresh checks", async (t) => {
  const f = await fixture(t);
  await f.engine.start("s");
  await f.engine.mutate("s", (s) => {
    s.verification = "interrupted-token";
  });
  const prior = process.env.MASTERGOAL_STATE_DIR;
  process.env.MASTERGOAL_STATE_DIR = f.state;
  t.after(() => {
    if (prior === undefined) delete process.env.MASTERGOAL_STATE_DIR;
    else process.env.MASTERGOAL_STATE_DIR = prior;
  });
  const hooks = await v1({
    directory: f.root,
    client: {
      tui: { showToast: async () => ({}) },
      session: {
        status: async () => ({ data: {} }),
        promptAsync: async () => ({}),
      },
    },
  });
  t.after(() => hooks.dispose());
  await hooks.event({
    event: { type: "session.idle", properties: { sessionID: "s" } },
  });
  assert.equal((await f.engine.store("s").read()).status, "paused");
  await hooks["command.execute.before"](
    { command: "goal", sessionID: "s", arguments: "resume" },
    { parts: [] },
  );
  assert.equal((await f.engine.verify("s")).iterations, 1);
});
