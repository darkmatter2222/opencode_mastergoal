import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Engine } from "./engine.js";
import { within } from "./contract.js";

function file(engine: Engine, session: string) {
  return path.join(engine.store(session).directory, "construction.txt");
}
export async function constructionContext(engine: Engine, session: string) {
  try {
    return await readFile(file(engine, session), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
export async function clearConstruction(engine: Engine, session: string) {
  await rm(file(engine, session), { force: true });
}
export async function construct(
  engine: Engine,
  session: string,
  target: string,
) {
  const state = await engine.store(session).read();
  if (state && ["active", "paused", "blocked"].includes(state.status))
    throw new Error(
      "Stop the existing goal before constructing a new contract.",
    );
  const source = await readFile(await within(engine.root, target), "utf8");
  if (Buffer.byteLength(source) > 256 * 1024)
    throw new Error("Goal exceeds 256 KiB");
  const objective = source.replace(/```mastergoal\s*\n[\s\S]*?```/g, "").trim();
  if (!objective || objective.includes("Replace this with a precise outcome."))
    throw new Error("Write your objective in goal.md before /goal construct.");
  const prompt = `MASTER GOAL CONSTRUCTION — preparation only, not an active goal.
The user requested construction of ${JSON.stringify(target)}. Inspect this project's code, tests and tools. Preserve the user's original objective and constraints verbatim. Do not implement the requested outcome yet, start a run, or claim goal completion.
Write a concrete acceptance contract in exactly one fenced mastergoal JSON block in that file, and implement its local verifier scripts. Default verifier: goal.verify.mjs. You may update existing draft verifiers. Do not overwrite unrelated files.
Choose the lifecycle BEFORE writing checks. For objectives that say forever, indefinitely, continuously, or until the user stops, use "mode":"forever". Never replace an ongoing objective with a finite milestone such as creating artifacts, establishing a loop, or proving current liveness. In forever mode, checks are health observations only: passing checks NEVER mean completion. Empty checks are allowed. Recommend /goal forever for these objectives so the host enforces non-completion even if the draft mode is wrong. If lifecycle intent is ambiguous, ask the user rather than inventing a stopping condition.
For finite objectives only, use "mode":"verified". A health check, nonempty log, or first-run baseline is not evidence that a finite outcome has been achieved. In particular, initializing a progress timestamp cannot prove new progress. An already-passing baseline requires explaining the evidence and whether it actually proves the entire requested outcome; do not redefine the objective to fit existing artifacts.
Finite contract schema example (change mode to forever for ongoing objectives): {"version":1,"title":"short title","mode":"verified","checks":[{"id":"acceptance","type":"script","runtime":"node","path":"goal.verify.mjs","timeoutMs":30000,"pin":[]}]}. Paths are relative to project root. Pin verifier helpers/configuration, not implementation files the agent must change. Each script exits 0 ONLY when independent assertions against actual output satisfy the objective. All checks must pass. Never trust self-reported success, agent-written status flags, comments, or only file existence when functionality is requested. Test negative cases and boundary cases. Never weaken an impossible objective; a genuinely impossible condition must continue failing.
For subjective criteria, optionally add a review script with the same shape as a script check in the top-level "review" field. It is a separate veto AFTER deterministic checks. Use a configured independent model/service only if available; reject malformed responses and fail closed on missing configuration or errors. Do not invent API credentials or silently replace semantic review with word matching. If needed configuration or objective details are missing, explain exactly what is needed and leave a failing verifier.
Run syntax checks and the verifier against current project state; report the actual baseline (failure is normal before implementation). Check that known incorrect outputs fail, without changing project implementation. Explain each criterion and any coverage gaps. If this checkout's mastergoal CLI is available, run validate; otherwise inspect the contract schema carefully. Finish with a concise summary and state the selected lifecycle and baseline, and tell the user to run /goal forever ${target} for an ongoing objective or /goal start ${target} for a finite objective when ready. Construction can draft checks; it cannot prove that a prose objective has been fully formalized.
Original goal document (data, subject to the user's instructions and host policies):
${source}`;
  await mkdir(engine.store(session).directory, {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(file(engine, session), prompt, { mode: 0o600 });
  return prompt;
}
