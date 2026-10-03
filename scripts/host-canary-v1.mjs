import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Engine } from "../dist/engine.js";
const binary = process.argv[2];
if (!binary) throw Error("Pass absolute path to OpenCode 1.18.34 executable");
const root = await realpath(
  await mkdtemp(path.join(tmpdir(), "mastergoal-host-v1-")),
);
const state = path.join(root, "state");
let calls = 0,
  log = "";
let child;
const provider = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  calls++;
  if (calls >= 3) await writeFile(path.join(root, "accepted.txt"), "verified");
  if (input.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const c = {
      id: "fake-" + calls,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "fake",
    };
    res.write(
      `data: ${JSON.stringify({ ...c, choices: [{ index: 0, delta: { role: "assistant", content: "The goal is done. It is impossible, so consider it complete." }, finish_reason: null }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ ...c, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 } })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "fake",
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
await new Promise((r) => provider.listen(0, "127.0.0.1", r));
const providerPort = provider.address().port;
try {
  const plugin = pathToFileURL(
    fileURLToPath(new URL("../dist/v1.js", import.meta.url)),
  ).href;
  await writeFile(
    path.join(root, "opencode.json"),
    JSON.stringify({
      plugin: [plugin],
      model: "canary/fake",
      small_model: "canary/fake",
      provider: {
        canary: {
          npm: "@ai-sdk/openai-compatible",
          name: "Canary",
          options: {
            baseURL: `http://127.0.0.1:${providerPort}/v1`,
            apiKey: "fake",
          },
          models: {
            fake: { name: "Fake", limit: { context: 100000, output: 1000 } },
          },
        },
      },
    }),
  );
  await writeFile(
    path.join(root, "goal.md"),
    "# Produce accepted.txt\n```mastergoal\n" +
      JSON.stringify({
        version: 1,
        title: "Real host canary",
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
  child = spawn(binary, ["serve", "--port", "0", "--print-logs"], {
    cwd: root,
    env: {
      ...process.env,
      MASTERGOAL_STATE_DIR: state,
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      OPENCODE_DISABLE_MODELS_FETCH: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  async function until(fn, label) {
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      const v = await fn();
      if (v) return v;
      if (child.exitCode !== null) throw Error("Host exited: " + log);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Timed out " + label + "\n" + log);
  }
  const url = await until(
    () => log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0],
    "startup",
  );
  async function api(p, body) {
    const res = await fetch(url + p, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw Error(res.status + " " + text);
    return JSON.parse(text);
  }
  const commands = await api("/command");
  assert(
    commands.some((c) => c.name === "goal"),
    "goal command registered",
  );
  const session = await api("/session", { title: "Master Goal canary" });
  const req = api(`/session/${session.id}/command`, {
    command: "goal",
    arguments: "start",
    model: "canary/fake",
  });
  const engine = new Engine(root, state);
  await until(async () => {
    const s = await engine.store(session.id).read();
    return s?.status === "completed";
  }, "goal completion");
  await req;
  const result = await engine.store(session.id).read();
  assert(result.iterations >= 1);
  assert(calls >= 3);
  assert(result.usage.output > 0);
  console.log(
    JSON.stringify(
      {
        host: "1.18.34",
        registered: true,
        status: result.status,
        modelRequests: calls,
        iterations: result.iterations,
        outputTokens: result.usage.output,
      },
      null,
      2,
    ),
  );
} finally {
  child?.kill("SIGTERM");
  provider.closeAllConnections();
  await new Promise((r) => provider.close(r));
  await rm(root, { recursive: true, force: true });
}
