import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export type Check = { id: string } & (
  | { type: "equals"; actual: unknown; expected: unknown }
  | { type: "file"; path: string; contains?: string; sha256?: string }
  | {
      type: "script";
      path: string;
      runtime: string;
      args?: string[];
      timeoutMs?: number;
      pin?: string[];
    }
);
export interface Contract {
  version: 1;
  title: string;
  mode: "verified" | "forever";
  checks: Check[];
  review?: Extract<Check, { type: "script" }>;
  intervalMs: number;
  limits?: {
    turns?: number;
    tokens?: number;
    cost?: number;
    elapsedMs?: number;
  };
}
export interface LockedGoal {
  file: string;
  markdown: string;
  digest: string;
  contract: Contract;
  pins: Record<string, string>;
}
export const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, allowed: string[]) {
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) throw new Error(`Unknown contract key: ${k}`);
}
function str(v: unknown, name: string): asserts v is string {
  if (typeof v !== "string" || !v.trim())
    throw new Error(`${name} must be nonempty text`);
}
function positive(v: unknown, name: string, min = 1) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min)
    throw new Error(`${name} must be >= ${min}`);
}
function check(v: unknown): Check {
  const c = object(v);
  str(c.id, "check.id");
  if (c.type === "equals") {
    keys(c, ["id", "type", "actual", "expected"]);
    if (!("actual" in c) || !("expected" in c))
      throw new Error("equals needs actual and expected");
  } else if (c.type === "file") {
    keys(c, ["id", "type", "path", "contains", "sha256"]);
    str(c.path, "file.path");
    if (c.contains !== undefined) str(c.contains, "contains");
    if (
      c.sha256 !== undefined &&
      (typeof c.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(c.sha256))
    )
      throw new Error("Invalid sha256");
  } else if (c.type === "script") {
    keys(c, ["id", "type", "path", "runtime", "args", "timeoutMs", "pin"]);
    str(c.path, "script.path");
    str(c.runtime, "runtime");
    for (const field of ["args", "pin"])
      if (
        c[field] !== undefined &&
        (!Array.isArray(c[field]) ||
          !(c[field] as unknown[]).every((x) => typeof x === "string"))
      )
        throw new Error(`Invalid ${field}`);
    if (c.timeoutMs !== undefined) {
      positive(c.timeoutMs, "timeoutMs");
      if (Number(c.timeoutMs) > 3_600_000)
        throw new Error("timeoutMs exceeds one hour");
    }
  } else throw new Error(`Unknown check type: ${c.type}`);
  return c as Check;
}
export function parseGoal(markdown: string): Contract {
  if (Buffer.byteLength(markdown) > 256_000)
    throw new Error("goal.md exceeds 256 KB");
  const blocks = [
    ...markdown.matchAll(/^```mastergoal\s*\r?\n([\s\S]*?)^```\s*$/gm),
  ];
  if (blocks.length !== 1)
    throw new Error("Provide exactly one fenced mastergoal JSON block");
  const c = object(JSON.parse(blocks[0]![1]!));
  keys(c, [
    "version",
    "title",
    "mode",
    "checks",
    "review",
    "intervalMs",
    "limits",
  ]);
  if (c.version !== 1) throw new Error("Unsupported contract version");
  str(c.title, "title");
  if (!["verified", "forever"].includes(String(c.mode)))
    throw new Error("mode must be verified or forever");
  if (!Array.isArray(c.checks) || c.checks.length > 100)
    throw new Error("checks must be an array of at most 100 checks");
  const checks = c.checks.map(check);
  if (c.mode === "verified" && !checks.length)
    throw new Error("Verified goals require at least one deterministic check");
  if (new Set(checks.map((x) => x.id)).size !== checks.length)
    throw new Error("Duplicate check IDs");
  if (c.review !== undefined && check(c.review).type !== "script")
    throw new Error("review must be a script");
  if (c.intervalMs !== undefined) positive(c.intervalMs, "intervalMs", 250);
  if (c.limits !== undefined) {
    const limits = object(c.limits);
    keys(limits, ["turns", "tokens", "cost", "elapsedMs"]);
    for (const [k, v] of Object.entries(limits)) positive(v, k);
  }
  return { ...c, checks, intervalMs: c.intervalMs ?? 1000 } as Contract;
}
export async function within(
  root: string,
  file: string,
  mustExist = true,
): Promise<string> {
  const base = await realpath(root),
    candidate = path.resolve(base, file);
  const resolved = mustExist
    ? await realpath(candidate)
    : path.join(
        await realpath(path.dirname(candidate)),
        path.basename(candidate),
      );
  const relative = path.relative(base, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Path escapes project: ${file}`);
  return resolved;
}
export async function lockGoal(
  root: string,
  file = "goal.md",
  forever = false,
): Promise<LockedGoal> {
  const resolved = await within(root, file),
    markdown = await readFile(resolved, "utf8");
  const contract = parseGoal(markdown);
  if (forever) contract.mode = "forever";
  const pins: Record<string, string> = {};
  for (const c of [
    ...contract.checks,
    ...(contract.review ? [contract.review] : []),
  ]) {
    if (c.type !== "script") continue;
    for (const p of [c.path, ...(c.pin ?? [])])
      pins[p] = digest(await readFile(await within(root, p)));
  }
  return { file: resolved, markdown, digest: digest(markdown), contract, pins };
}
export async function assertIntegrity(root: string, goal: LockedGoal) {
  if (digest(await readFile(await within(root, goal.file))) !== goal.digest)
    throw new Error(
      "goal.md changed after start; stop and start a new run to approve the new contract",
    );
  for (const [p, hash] of Object.entries(goal.pins))
    if (digest(await readFile(await within(root, p))) !== hash)
      throw new Error(`Pinned verifier changed: ${p}`);
}
