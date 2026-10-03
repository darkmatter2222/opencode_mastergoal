import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
export async function install(
  root: string,
  host: 1 | 2,
  remove = false,
  packageRoot?: string,
) {
  const dist = packageRoot
    ? path.join(packageRoot, "dist")
    : path.dirname(fileURLToPath(import.meta.url));
  const entries = [
    {
      name: "opencode",
      entry: host === 1 ? "v1.js" : "server.js",
      key: host === 1 ? "plugin" : "plugins",
    },
    {
      name: "tui",
      entry: host === 1 ? "tui-v1.js" : "tui.js",
      key: host === 1 ? "plugin" : "plugins",
    },
  ];
  const plans: {
    file: string;
    before: string;
    after: string;
    exists: boolean;
  }[] = [];
  for (const e of entries) {
    let before = "{}\n",
      file = path.join(root, `${e.name}.json`),
      exists = false;
    for (const ext of ["jsonc", "json"]) {
      try {
        before = await readFile(path.join(root, `${e.name}.${ext}`), "utf8");
        file = path.join(root, `${e.name}.${ext}`);
        exists = true;
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    const errors: ParseError[] = [];
    const config = parse(before, errors, { allowTrailingComma: true });
    if (
      errors.length ||
      !config ||
      typeof config !== "object" ||
      Array.isArray(config)
    )
      throw new Error(`Invalid config: ${file}`);
    const old = config[e.key] ?? [];
    if (!Array.isArray(old))
      throw new Error(`${e.key} must be an array in ${file}`);
    const spec = pathToFileURL(
      host === 2 ? path.dirname(dist) : path.join(dist, e.entry),
    ).href;
    const list = old.filter((x: unknown) => x !== spec);
    if (!remove) list.push(spec);
    const after = applyEdits(
      before,
      modify(before, [e.key], list, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
    plans.push({ file, before, after, exists });
  }
  await mkdir(root, { recursive: true });
  for (const p of plans) {
    if (p.exists) await writeFile(`${p.file}.mastergoal.bak`, p.before);
    await writeFile(`${p.file}.mastergoal.tmp`, p.after);
    await rename(`${p.file}.mastergoal.tmp`, p.file);
  }
  return plans.map((p) => p.file);
}
