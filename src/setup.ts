import { mkdtemp, mkdir, rm, cp, readFile, writeFile } from "node:fs/promises";
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
/** Stage a compiled distribution without lifecycle hooks or build dependencies.
 * npm 10 can run prepare during directory packing despite --ignore-scripts.
 * Never mutate the source checkout or the shared npx cache to work around it.
 */
export async function stageRuntime(source: string, destination: string) {
  const manifest = JSON.parse(
    await readFile(path.join(source, "package.json"), "utf8"),
  );
  const files = [
    "dist",
    "server.js",
    "tui.js",
    "README.md",
    "LICENSE",
    "docs",
    "examples",
  ];
  await mkdir(destination, { recursive: true });
  for (const file of files)
    await cp(path.join(source, file), path.join(destination, file), {
      recursive: true,
    });
  delete manifest.scripts;
  delete manifest.devDependencies;
  manifest.files = files;
  await writeFile(
    path.join(destination, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
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
    const staged = path.join(temp, "package");
    await stageRuntime(source, staged);
    const packed = await runNpm(
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temp],
      staged,
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
