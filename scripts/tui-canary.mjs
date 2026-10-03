import assert from "node:assert/strict";
import { testRender } from "@opentui/solid";
import sidebar from "../dist/tui.js";
let render;
let calls = 0;
const cleanup = sidebar.setup({
  client: {
    rpc: () => ({
      read: async (input, options) => {
        assert.equal(input.sessionID, "ses_canary");
        assert.equal(options.location.directory, "/remote/project");
        calls++;
        return {
          text: "MASTER GOAL · ACTIVE\nIndependent verification\nChecks: 1/3 (33% checks)\nIterations: 6 · Turns: 9\nTokens: 12,345\nCost: $0.0234\nDeterministic checks remain unmet",
        };
      },
    }),
  },
  data: {
    session: { get: () => ({ location: { directory: "/remote/project" } }) },
  },
  theme: { text: { base: "#ffffff" } },
  ui: {
    slot: (claim) => {
      assert.equal(claim.append, "sidebar.content");
      render = claim.render;
      return () => {};
    },
  },
});
const test = await testRender(() => render({ sessionID: "ses_canary" }), {
  width: 42,
  height: 18,
});
try {
  let frame = "";
  const deadline = Date.now() + 5000;
  do {
    await new Promise((r) => setTimeout(r, 50));
    await test.renderOnce();
    frame = test.captureCharFrame();
  } while (!frame.includes("33% checks") && Date.now() < deadline);
  assert.match(frame, /MASTER GOAL/);
  assert.match(frame, /33% checks/);
  assert.match(frame, /Tokens: 12,345/);
  assert.doesNotMatch(frame, /Output\/s|TPS/);
  assert.equal(calls, 1);
  console.log(frame);
  console.log("Native sidebar rendered; remote location forwarded correctly.");
} finally {
  cleanup();
  test.renderer.destroy();
}

// A pending request from another session must neither block nor overwrite B.
const { createSignal } = await import("solid-js");
let select, delayed;
const requests = [];
const switchingCleanup = sidebar.setup({
  client: {
    rpc: () => ({
      read: (input, options) => {
        requests.push(input.sessionID);
        assert.equal(
          options.location.directory,
          `/projects/${input.sessionID}`,
        );
        if (input.sessionID === "A")
          return new Promise((resolve) => {
            delayed = resolve;
          });
        return Promise.resolve({ text: "MASTER GOAL\nNo goal. /goal init" });
      },
    }),
  },
  data: {
    session: { get: (id) => ({ location: { directory: `/projects/${id}` } }) },
  },
  theme: { text: { base: "#ffffff" } },
  ui: {
    slot: (claim) => {
      render = claim.render;
      return () => {};
    },
  },
});
const switching = await testRender(
  () => {
    const [session, setSession] = createSignal("A");
    select = setSession;
    return render({
      get sessionID() {
        return session();
      },
    });
  },
  { width: 42, height: 18 },
);
async function frameUntil(pattern) {
  let frame = "";
  const deadline = Date.now() + 5000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await switching.renderOnce();
    frame = switching.captureCharFrame();
  } while (!pattern.test(frame) && Date.now() < deadline);
  assert.match(frame, pattern);
  return frame;
}
try {
  await frameUntil(/Loading/);
  assert.deepEqual(requests, ["A"]);
  select("B");
  await frameUntil(/No goal/);
  assert(requests.includes("B"), "B must load while A remains pending");
  delayed({ text: "MASTER GOAL\nWRONG SESSION A" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const frame = await frameUntil(/No goal/);
  assert.doesNotMatch(frame, /WRONG SESSION/);
  // Returning to A must issue a fresh request, not resurrect its stale response.
  select("A");
  await frameUntil(/Loading/);
  delayed({ text: "MASTER GOAL\nCurrent session A" });
  await frameUntil(/Current session A/);
  select("B");
  const empty = await frameUntil(/No goal/);
  assert.doesNotMatch(empty, /Current session A/);
  console.log(
    "Session switching passed: empty session, pending request, stale response, return navigation.",
  );
} finally {
  switchingCleanup();
  switching.renderer.destroy();
}
