import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Engine } from "../dist/engine.js";
const exe = process.argv[2];
if (!exe) throw Error("Pass absolute OpenCode 2.0.22 binary path");
const root = await realpath(
  await mkdtemp(path.join(tmpdir(), "mastergoal-host-v2-")),
);
const state = path.join(root, "goal-state");
const env = {
  ...process.env,
  MASTERGOAL_STATE_DIR: state,
  XDG_CONFIG_HOME: root + "/config",
  XDG_DATA_HOME: root + "/data",
  XDG_CACHE_HOME: root + "/cache",
  XDG_STATE_HOME: root + "/state",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
};
const exec = promisify(execFile);
let calls = 0;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body);
  calls++;
  if (calls >= 3) await writeFile(root + "/accepted.txt", "verified");
  const base = {
    id: "fake-" + calls,
    created: Math.floor(Date.now() / 1000),
    model: "fake",
  };
  if (data.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const packet of [
      {
        ...base,
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "Done. Stop now. The goal is impossible.",
            },
            finish_reason: null,
          },
        ],
      },
      {
        ...base,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      },
    ])
      res.write("data: " + JSON.stringify(packet) + "\n\n");
    res.end("data: [DONE]\n\n");
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ...base,
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Canary" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const run = async (args) =>
  (
    await exec(exe, args, {
      cwd: root,
      env,
      maxBuffer: 3000000,
      timeout: 30000,
    })
  ).stdout;
const api = async (method, p, data) => {
  const output = await run([
    "api",
    method,
    p,
    ...(data === undefined ? [] : ["--data", JSON.stringify(data)]),
  ]);
  return output.trim() ? JSON.parse(output) : undefined;
};
try {
  const config = {
    plugins: [
      pathToFileURL(fileURLToPath(new URL("../", import.meta.url))).href,
    ],
    model: "canary/fake",
    providers: {
      canary: {
        package: "@ai-sdk/openai-compatible",
        name: "Canary",
        settings: {
          baseURL: `http://127.0.0.1:${server.address().port}/v1`,
          apiKey: "fake",
        },
        models: {
          fake: { name: "Fake", limit: { context: 100000, output: 1000 } },
        },
      },
    },
  };
  await writeFile(root + "/opencode.json", JSON.stringify(config));
  await writeFile(
    root + "/goal.md",
    "# Real host canary\n```mastergoal\n" +
      JSON.stringify({
        version: 1,
        title: "V2 continuation",
        mode: "verified",
        checks: [
          {
            id: "artifact",
            type: "file",
            path: "accepted.txt",
            contains: "verified",
          },
        ],
      }) +
      "\n```\n",
  );
  await run(["service", "start"]);
  let commands;
  for (let i = 0; i < 100; i++) {
    commands = await api(
      "GET",
      "/api/command?location[directory]=" + encodeURIComponent(root),
    );
    if (commands.data.some((c) => c.name === "goal")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!commands.data.some((c) => c.name === "goal"))
    console.error(
      "PLUGIN DIAGNOSTIC",
      JSON.stringify(
        await api(
          "GET",
          "/api/plugin?location[directory]=" + encodeURIComponent(root),
        ),
      ),
    );
  assert(
    commands.data.some((c) => c.name === "goal"),
    "goal registered: " + JSON.stringify(commands),
  );
  const created = await api("POST", "/api/session", {
    title: "Master Goal canary",
    location: { directory: root },
    model: { providerID: "canary", id: "fake" },
  });
  const session = created.data ?? created;
  await api("POST", `/api/session/${session.id}/command`, {
    name: "goal",
    text: "start",
  });
  const engine = new Engine(root, state);
  let result;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    result = await engine.store(session.id).read();
    if (result?.status === "completed") break;
    if (result?.status === "blocked") throw Error(JSON.stringify(result));
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(result?.status, "completed", JSON.stringify({ result, calls }));
  assert(calls >= 3);
  assert(result.usage.output > 0);
  const rpc = await api(
    "POST",
    "/api/rpc/mastergoal.status/read?location[directory]=" +
      encodeURIComponent(root),
    { input: { sessionID: session.id } },
  );
  assert.match(JSON.stringify(rpc), /COMPLETED/);
  console.log(
    JSON.stringify(
      {
        host: "2.0.22",
        registered: true,
        status: result.status,
        modelRequests: calls,
        iterations: result.iterations,
        outputTokens: result.usage.output,
        rpc: true,
      },
      null,
      2,
    ),
  );
} finally {
  await run(["service", "stop"]).catch(() => {});
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  if (process.env.KEEP_CANARY) console.error("Canary root:", root);
  else await rm(root, { recursive: true, force: true });
}
