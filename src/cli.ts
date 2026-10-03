#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Engine } from "./engine.js";
import { command, initGoal, help } from "./commands.js";
import { lockGoal } from "./contract.js";
import { install } from "./install.js";
export async function main(args = process.argv.slice(2)) {
  const action = args.shift() ?? "help";
  if (action === "help" || action === "--help") {
    console.log(
      `Master Goal\nmastergoal install --host 1|2 [project-directory]\nmastergoal uninstall --host 1|2 [project-directory]\nmastergoal init [goal.md]\nmastergoal validate [goal.md]\nmastergoal status|inspect|check|pause|stop|resume --session SESSION_ID\nOpenCode: ${help}`,
    );
    return;
  }
  if (action === "install" || action === "uninstall") {
    if (args[0] !== "--host" || !["1", "2"].includes(args[1] ?? ""))
      throw new Error("Specify --host 1 or --host 2");
    const files = await install(
      path.resolve(args[2] ?? "."),
      Number(args[1]) as 1 | 2,
      action === "uninstall",
    );
    console.log(files.join("\n"));
    return;
  }
  const root = await realpath(process.cwd());
  if (action === "init") {
    console.log(await initGoal(root, args[0]));
    return;
  }
  if (action === "validate") {
    const goal = await lockGoal(root, args[0]);
    console.log(
      `Valid: ${goal.contract.title}\n${goal.digest}\n${goal.contract.checks.length} checks; ${Object.keys(goal.pins).length} pinned files`,
    );
    return;
  }
  if (args[0] !== "--session" || !args[1])
    throw new Error(
      "Supply --session SESSION_ID. Start goals inside OpenCode with /goal start.",
    );
  if (["start", "forever"].includes(action))
    throw new Error("Start goals using /goal start inside OpenCode");
  const result = await command(new Engine(root), args[1], action);
  console.log(result.text);
  if (result.kick)
    console.log(
      "State resumed. In OpenCode, send a message to wake the session.",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  void main().catch((e) => {
    console.error(`Master Goal: ${e.message}`);
    process.exitCode = 1;
  });
