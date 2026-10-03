import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { install } from "./install.js";
const exec = promisify(execFile);
export function globalConfig(env = process.env) {
  return (
    env.OPENCODE_CONFIG_DIR ||
    path.join(
      env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
      "opencode",
    )
  );
}
export async function setup(root: string, host: 1 | 2, remove = false) {
  // Never register the disposable npx cache. Install a self-contained runtime.
  const managed = path.join(root, ".mastergoal-runtime");
  const packageRoot = path.join(
    managed,
    "node_modules",
    "@darkmatter2222",
    "opencode-mastergoal",
  );
  if (remove) return install(root, host, true, packageRoot);
  const temp = await mkdtemp(path.join(tmpdir(), "mastergoal-install-"));
  const npmScript = process.env.npm_execpath?.endsWith(".js")
    ? process.env.npm_execpath
    : process.platform === "win32"
      ? path.join(
          path.dirname(process.execPath),
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        )
      : undefined;
  const runNpm = (args: string[], cwd: string) =>
    exec(
      npmScript ? process.execPath : "npm",
      npmScript ? [npmScript, ...args] : args,
      { cwd, maxBuffer: 4 * 1024 * 1024 },
    );
  try {
    const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const packed = await runNpm(
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temp],
      source,
    );
    const filename = JSON.parse(packed.stdout)[0].filename as string;
    await mkdir(managed, { recursive: true });
    await runNpm(
      [
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        path.join(temp, filename),
      ],
      managed,
    );
    return await install(root, host, false, packageRoot);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
