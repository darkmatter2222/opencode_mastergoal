#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "./engine.js";
import { command, initGoal, help } from "./commands.js";
import { lockGoal } from "./contract.js";
import { install } from "./install.js";
import { setup, globalConfig } from "./setup.js";
export async function main(args = process.argv.slice(2)) {
  const action = args.shift() ?? "help";
  if (action === "help" || action === "--help") {
    console.log(
      `Master Goal\nmastergoal install --global | --local [project-directory]\nmastergoal uninstall --global | --local [project-directory]\nmastergoal init [goal.md]\nmastergoal validate [goal.md]\nmastergoal status|inspect|check|pause|stop|resume --session SESSION_ID\nOpenCode: ${help}`,
    );
    return;
  }
  if (action === "install" || action === "uninstall") {
    const hostIndex = args.indexOf("--host");
    if (hostIndex >= 0) {
      if (args[hostIndex + 1] !== "2")
        throw new Error(
          "Master Goal requires OpenCode 2.x (tested with 2.0.22). Upgrade OpenCode before installing.",
        );
      args.splice(hostIndex, 2);
    }
    const global = args.includes("--global");
    const local = args.includes("--local");
    const linked = args.includes("--link");
    if (global && local)
      throw new Error("Choose --global or --local, not both");
    const positional = args.filter(
      (a) => !["--global", "--local", "--link"].includes(a),
    );
    if (
      positional.length > 1 ||
      positional.some((a) => a.startsWith("--")) ||
      (global && positional.length)
    )
      throw new Error(
        "Usage: mastergoal install --global | --local [project-directory]",
      );
    const root = global ? globalConfig() : path.resolve(positional[0] ?? ".");
    const files = await (linked ? install : setup)(
      root,
      action === "uninstall",
    );
    console.log(files.join("\n"));
    if (action === "install")
      console.log(
        "Master Goal installed for OpenCode 2.x. Close OpenCode, run opencode service stop, then reopen and use /goal help. The sidebar loads with the server plugin.",
      );
    return;
  }
  if (action === "construct")
    throw new Error(
      "Run /goal construct inside OpenCode to use its model and tools.",
    );
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
  (await realpath(fileURLToPath(import.meta.url))) ===
    (await realpath(process.argv[1]))
)
  void main().catch((e) => {
    console.error(`Master Goal: ${e.message}`);
    process.exitCode = 1;
  });
