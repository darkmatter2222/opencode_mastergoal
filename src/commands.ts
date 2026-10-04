import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Engine, formatStatus } from "./engine.js";
import { construct, clearConstruction } from "./construct.js";
import { within } from "./contract.js";
export const template = `# Master Goal\n\n## Objective\nReplace this with a precise outcome. Describe constraints, allowed changes, and evidence.\n\n## Acceptance contract\nThe verifier must independently test the outcome. It must not trust agent-written status files.\n\n\`\`\`mastergoal\n{\n  "version": 1,\n  "title": "My goal",\n  "mode": "verified",\n  "intervalMs": 1000,\n  "checks": [\n    {"id": "acceptance", "type": "script", "runtime": "node", "path": "goal.verify.mjs", "timeoutMs": 30000}\n  ]\n}\n\`\`\`\n\n## Working plan\n- [ ] Define independently testable acceptance criteria\n- [ ] Implement the outcome\n- [ ] Inspect host verification evidence\n\n## Constraints\nDo not weaken the acceptance contract or verifier to obtain a pass.\n`;
export const scriptTemplate = `// /goal construct replaces this placeholder with independent assertions.\n// Exit 0 only when the actual objective is satisfied. Any other exit fails.\n// Pin imported verifier dependencies using the check's "pin" array.\nconsole.error('Acceptance verifier has not been implemented');\nprocess.exitCode = 1;\n`;
export async function initGoal(root: string, file = "goal.md") {
  const dest = await within(root, file, false);
  // Exclusive writes deliberately refuse to overwrite user work.
  await writeFile(dest, template, { flag: "wx" });
  try {
    await writeFile(path.join(root, "goal.verify.mjs"), scriptTemplate, {
      flag: "wx",
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return `Created ${file}. Write your objective in ${file}, then /goal construct ${file}, then /goal start ${file}.`;
}
export const help =
  "/goal init [path] | construct [path] | start [path] | forever [path] | status | inspect | check | pause | resume | stop | end\nRaw images per model request: imageWindow defaults to 1 (2 = latest two, 0 = no raw images). Configure plugins[].options.imageWindow in opencode.json[c], or MASTERGOAL_IMAGE_WINDOW; restart OpenCode. Session history is preserved.";
export async function command(
  engine: Engine,
  session: string,
  input: string,
): Promise<{ text: string; kick: boolean; construction?: string }> {
  const match = input.trim().match(/^(\S+)?\s*([\s\S]*)$/)!;
  const action = match[1] ?? "status",
    arg = match[2]?.trim() || "goal.md";
  let kick = false,
    text = "";
  switch (action) {
    case "init":
      text = await initGoal(engine.root, arg);
      break;
    case "construct":
      return {
        text: `Constructing verification for ${arg}.`,
        kick: false,
        construction: await construct(engine, session, arg),
      };
    case "start":
    case "forever":
      await engine.start(session, arg, action === "forever");
      await clearConstruction(engine, session);
      kick = true;
      break;
    case "pause":
    case "stop":
    case "end":
      await clearConstruction(engine, session);
      await engine.control(session, action === "end" ? "stop" : action);
      break;
    case "resume":
      await engine.control(session, "resume");
      kick = true;
      break;
    case "check":
      await engine.verify(session);
      break;
    case "inspect":
      text = JSON.stringify(await engine.store(session).read(), null, 2);
      break;
    case "status":
      break;
    case "help":
      text = help;
      break;
    default:
      throw new Error(`Unknown goal action: ${action}. ${help}`);
  }
  return {
    text: text || formatStatus(await engine.store(session).read()),
    kick,
  };
}
