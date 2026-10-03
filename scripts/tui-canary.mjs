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
  await new Promise((r) => setTimeout(r, 50));
  await test.renderOnce();
  const frame = test.captureCharFrame();
  assert.match(frame, /MASTER GOAL/);
  assert.match(frame, /33% checks/);
  assert.match(frame, /42.0/);
  assert.equal(calls, 1);
  console.log(frame);
  console.log("Native sidebar rendered; remote location forwarded correctly.");
} finally {
  cleanup();
  test.renderer.destroy();
}
