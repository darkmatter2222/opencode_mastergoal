import test from "node:test";
import assert from "node:assert/strict";
import v2 from "../dist/server.js";
import { fixture, contract } from "./helpers.mjs";
import { Engine } from "../dist/engine.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const draft = { sessionID: "s", system: [], messages: [] };
  await hooks.compaction(draft);
  assert.match(draft.system[0].text, /MASTER GOAL CONSTRUCTION/);

  await cmd.execute({
    sessionID: "s",
    prompt: { text: "start" },
    delivery: "queue",
  });
  assert.equal(synthetic[0].resume, false);
  const context = { sessionID: "s", system: [], messages: [] };
  await hooks.context(context);
  assert(context.system[0].text.includes("MASTER GOAL"));
  for (const name of ["context", "compaction", "generate", "title"]) {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: "user",
      content: [
        { type: "text", text: String(i) },
        { type: "media", media: { kind: "image", mediaType: "image/png" } },
      ],
    }));
    const request = { sessionID: "no-goal", system: [], messages };
    await hooks[name](request);
    assert.equal(
      request.messages
        .flatMap((m) => m.content)
        .filter((p) => p.type === "media").length,
      1,
    );
    assert.equal(
      messages.flatMap((m) => m.content).filter((p) => p.type === "media")
        .length,
      100,
    );
    assert.equal(request.messages.at(-1).content[0].text, "99");
  }
  assert.match((await rpc.read({ sessionID: "s" })).text, /Image window: 1/);

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
  let state;
  const deadline = Date.now() + 5000;
  do {
    await wait(10);
    state = await f.engine.store("s").read();
  } while (state.usage.output !== 5 && Date.now() < deadline);
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
