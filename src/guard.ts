import path from "node:path";
import { realpath } from "node:fs/promises";
import { Engine } from "./engine.js";

/** Structured edit protection. Arbitrary shell execution is not an OS sandbox. */
export async function guardTool(
  engine: Engine,
  session: string,
  tool: string,
  args: unknown,
) {
  const state = await engine.store(session).read();
  if (!state || state.status !== "active" || !/write|edit|patch/.test(tool))
    return;
  const protectedPaths = new Set([
    state.goal.file,
    ...Object.keys(state.goal.pins).map((p) => path.resolve(engine.root, p)),
  ]);
  const candidates: string[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (
        ["filePath", "file_path", "path", "file"].includes(key) &&
        typeof item === "string"
      )
        candidates.push(item);
      else if (
        ["patch", "patchText"].includes(key) &&
        typeof item === "string"
      ) {
        for (const line of item.split(/\r?\n/)) {
          const match = line.match(
            /^\*\*\* (?:(?:Add|Update|Delete) File:|Move to:)\s*(.+)$/,
          );
          if (match) candidates.push(match[1]!);
        }
      } else if (typeof item === "object") visit(item);
    }
  }
  visit(args);
  for (const candidate of candidates) {
    const absolute = path.resolve(engine.root, candidate);
    const resolved = await realpath(absolute).catch(() => absolute);
    if (protectedPaths.has(absolute) || protectedPaths.has(resolved)) {
      throw new Error(
        "Master Goal contract/verifier is locked for this run. User must stop and restart to revise it.",
      );
    }
  }
}
